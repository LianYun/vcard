import type { Card, ReviewRecord } from '../types'
import { addDays, todayKey } from './date'

export function isRecentForgottenReview(review: ReviewRecord, day: string): boolean {
  return !review.undone && review.quality < 3 && review.day >= addDays(day, -6) && review.day <= day
}

/** One card per round, with the most frequently forgotten cards first. */
export function recentForgottenCards(cards: Card[], reviews: ReviewRecord[], day = todayKey()): Card[] {
  const counts = new Map<string, number>()
  for (const review of reviews) if (isRecentForgottenReview(review, day)) {
    counts.set(review.cardId, (counts.get(review.cardId) ?? 0) + 1)
  }
  return cards.filter(card => counts.has(card.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || a.id.localeCompare(b.id))
}
