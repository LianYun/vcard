import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Card, ProgressMap, ReviewButton, SchedulingState } from '../types'
import { GRADE_BY_BUTTON, grade as sm2Grade, initialState } from '../lib/sm2'
import { schedule } from '../lib/scheduler'
import {
  loadMeta,
  loadProgress,
  loadSettings,
  saveMeta,
  saveOneProgress,
} from '../lib/storage'
import { allCards } from '../lib/cardStore'
import { todayKey } from '../lib/date'

export interface ReviewQueueState {
  current: Card | null
  total: number
  remaining: number
  done: number
  ready: boolean
  finished: boolean
  relearned: number
}

export interface ReviewQueue extends ReviewQueueState {
  review: (button: ReviewButton) => void
  reset: () => void
}

export function useReviewQueue(): ReviewQueue {
  const [progress, setProgress] = useState<ProgressMap>({})
  const [queue, setQueue] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(0)
  const [relearned, setRelearned] = useState(0)

  const buildQueue = useCallback(async () => {
    const [cards, prog, settings, meta] = await Promise.all([
      allCards(),
      loadProgress(),
      loadSettings(),
      loadMeta(),
    ])

    const result = schedule(cards, prog, settings, meta)

    let nextProgress = { ...prog }
    for (const card of result.newCards) {
      if (!nextProgress[card.id]) {
        const fresh = initialState(card.id, todayKey())
        nextProgress[card.id] = fresh
        await saveOneProgress(fresh)
      }
    }

    if (result.meta.newCardsDate !== meta.newCardsDate || result.meta.newCardsIssued !== meta.newCardsIssued) {
      await saveMeta(result.meta)
    }

    setProgress(nextProgress)
    const fullQueue = [...result.dueReviews, ...result.newCards]
    setQueue(fullQueue)
    setTotal(fullQueue.length)
    setDone(0)
    setRelearned(0)
    setReady(true)
  }, [])

  useEffect(() => {
    buildQueue()
  }, [buildQueue])

  const review = useCallback(
    (button: ReviewButton) => {
      setQueue((q) => {
        if (q.length === 0) return q
        const [current, ...rest] = q

        const state = progress[current.id] ?? initialState(current.id, todayKey())
        const updated: SchedulingState = sm2Grade(state, GRADE_BY_BUTTON[button])

        setProgress((prev) => {
          const next = { ...prev, [current.id]: updated }
          return next
        })

        saveOneProgress(updated)

        if (button === 'again') {
          setRelearned((n) => n + 1)
          return [...rest, current]
        }

        setDone((d) => d + 1)
        return rest
      })
    },
    [progress],
  )

  const reset = useCallback(() => {
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
