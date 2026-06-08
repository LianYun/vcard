// useReviewQueue: drives a live study/review session.
//
// On mount, it builds today's queue from the scheduler (due reviews + new cards),
// seeding fresh progress entries for new cards. Each `grade(button)` call:
//   - applies SM-2 to the current card and persists the new progress,
//   - persists the updated new-cards-issued meta,
//   - removes the card from the queue (Anki-style), UNLESS the user pressed
//     "again" — in that case the card is re-appended to the queue so it resurfaces
//     within this session (mimicking Anki's "learning steps").

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Card, ProgressMap, ReviewButton, Settings, SchedulingState } from '../types'
import { GRADE_BY_BUTTON, grade as sm2Grade } from '../lib/sm2'
import { schedule } from '../lib/scheduler'
import {
  loadMeta,
  loadProgress,
  loadSettings,
  saveMeta,
  saveProgress,
} from '../lib/storage'
import type { Meta } from '../lib/storage'
import { allCards } from '../lib/cardStore'

export interface ReviewQueueState {
  /** Card currently being shown (or null when session is done). */
  current: Card | null
  /** Initial size of the queue (for progress display). */
  total: number
  /** Cards remaining (including current). */
  remaining: number
  /** Cards completed this session (unique, counting only final removal). */
  done: number
  /** True once the queue has been initialized. */
  ready: boolean
  /** Session is finished (current is null). */
  finished: boolean
  /** How many times the user re-queued cards via "again" this session. */
  relearned: number
}

export interface ReviewQueue extends ReviewQueueState {
  /** Advance: grade current card with the given button and move on. */
  review: (button: ReviewButton) => void
  /** Reset the queue (re-pull from scheduler). */
  reset: () => void
}

export function useReviewQueue(): ReviewQueue {
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress())
  const [settings] = useState<Settings>(() => loadSettings())
  const [meta, setMeta] = useState<Meta>(() => loadMeta())
  const [queue, setQueue] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(0)
  const [relearned, setRelearned] = useState(0)

  const buildQueue = useCallback(() => {
    const result = schedule(allCards(), progress, settings, meta)
    // Seed progress entries for the new cards being introduced today so that
    // they are no longer "fresh" if the user closes the tab mid-session.
    let nextProgress = progress
    for (const card of result.newCards) {
      if (!nextProgress[card.id]) {
        nextProgress = {
          ...nextProgress,
          [card.id]: freshState(card.id),
        }
      }
    }
    if (nextProgress !== progress) {
      setProgress(nextProgress)
      saveProgress(nextProgress)
    }
    if (result.meta !== meta) {
      setMeta(result.meta)
      saveMeta(result.meta)
    }

    // Interleave: due reviews first (most overdue), then new cards. The learning
    // philosophy is to clear reviews before dumping new material on the user.
    const fullQueue = [...result.dueReviews, ...result.newCards]
    setQueue(fullQueue)
    setTotal(fullQueue.length)
    setDone(0)
    setRelearned(0)
    setReady(true)
  }, [progress, settings, meta])

  useEffect(() => {
    buildQueue()
    // Only rebuild when progress or meta identity changes externally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const review = useCallback(
    (button: ReviewButton) => {
      setQueue((q) => {
        if (q.length === 0) return q
        const [current, ...rest] = q

        setProgress((prevProgress) => {
          const state =
            prevProgress[current.id] ?? freshState(current.id)
          const updated: SchedulingState = sm2Grade(
            state,
            GRADE_BY_BUTTON[button],
          )
          const nextProgress = { ...prevProgress, [current.id]: updated }
          saveProgress(nextProgress)
          return nextProgress
        })

        if (button === 'again') {
          // Re-append for in-session relearning (back of the queue).
          setRelearned((n) => n + 1)
          return [...rest, current]
        }

        setDone((d) => d + 1)
        return rest
      })
    },
    [],
  )

  const reset = useCallback(() => {
    setProgress(loadProgress())
    setMeta(loadMeta())
    buildQueue()
  }, [buildQueue])

  const state: ReviewQueueState = useMemo(
    () => ({
      current: queue[0] ?? null,
      total,
      remaining: queue.length,
      done,
      ready,
      finished: ready && queue.length === 0,
      relearned,
    }),
    [queue, total, done, ready, relearned],
  )

  return { ...state, review, reset }
}

function freshState(cardId: string): SchedulingState {
  // Local import avoids circular ref with sm2 default ease; keep self-contained.
  // Equivalent to initialState(cardId).
  return {
    cardId,
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    due: localToday(),
    lastReviewedAt: null,
  }
}

function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
