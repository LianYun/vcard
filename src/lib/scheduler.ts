// Scheduler: decides which cards to study today.
//
// A study session is the union of:
//   1. Due reviews — cards that have been seen before and whose `due` date is
//      today or earlier (laps are OR'd this way because `again` sets due tomorrow,
//      so a "again" graded card resurfaces within the day on the next refresh).
//   2. New cards — cards never reviewed, up to `settings.newCardsPerDay` minus
//      how many were already issued today (tracked in meta).
//
// The scheduler is pure w.r.t. its inputs; it does not touch localStorage.
// Persistence of the "new cards issued" counter is the caller's job.

import type { Card, ProgressMap, Settings, SchedulingState } from '../types'
import type { Meta } from './storage'
import { todayKey } from './date'
import { initialState } from './sm2'

export interface ScheduleResult {
  /** Due review cards, ordered by most-overdue first. */
  dueReviews: Card[]
  /** New cards to introduce, capped by the daily budget. */
  newCards: Card[]
  /** Updated meta reflecting new-cards-issued counter after this scheduling. */
  meta: Meta
}

/** Whether a card has never been introduced (no progress entry at all). */
function isFresh(state: SchedulingState | undefined): boolean {
  return !state
}

/** Days overdue (negative = future). 0 means due today. */
function daysOverdue(state: SchedulingState, refKey: string): number {
  const [ry, rm, rd] = refKey.split('-').map(Number)
  const [dy, dm, dd] = state.due.split('-').map(Number)
  const a = Date.UTC(ry, rm - 1, rd)
  const b = Date.UTC(dy, dm - 1, dd)
  return Math.round((a - b) / 86_400_000)
}

/**
 * Compute today's study queue.
 *
 * @param cards    all known cards (built-in + custom)
 * @param progress per-card scheduling state
 * @param settings user settings (newCardsPerDay budget)
 * @param meta     session bookkeeping (new-cards-issued-today)
 */
export function schedule(
  cards: Card[],
  progress: ProgressMap,
  settings: Settings,
  meta: Meta,
): ScheduleResult {
  const today = todayKey()

  // Reset the per-day new-card counter when the day rolls over.
  const effectiveMeta: Meta =
    meta.newCardsDate === today
      ? meta
      : { newCardsDate: today, newCardsIssued: 0 }

  const dueReviews: Card[] = []
  const fresh: Card[] = []

  for (const card of cards) {
    const state = progress[card.id]
    if (isFresh(state)) {
      fresh.push(card)
      continue
    }
    // Seen before: due if its scheduled date is today or earlier.
    if (state!.due <= today) {
      dueReviews.push(card)
    }
  }

  // Most overdue first.
  dueReviews.sort((a, b) => {
    const da = daysOverdue(progress[a.id]!, today)
    const db = daysOverdue(progress[b.id]!, today)
    return db - da
  })

  // New cards: respect remaining daily budget.
  const remainingBudget = Math.max(0, settings.newCardsPerDay - effectiveMeta.newCardsIssued)
  const newCards = fresh.slice(0, remainingBudget)
  const newlyIssued = newCards.length

  return {
    dueReviews,
    newCards,
    meta: {
      ...effectiveMeta,
      newCardsIssued: effectiveMeta.newCardsIssued + newlyIssued,
    },
  }
}

/** Build an initial progress entry for a brand-new card being introduced today. */
export function seedNewCard(cardId: string): SchedulingState {
  return initialState(cardId)
}
