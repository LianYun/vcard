// SuperMemo-2 (SM-2) spaced-repetition algorithm.
//
// Reference: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
//
// These are pure functions: given a prior SchedulingState and a review Quality,
// they return the next SchedulingState. No side effects, easy to unit test.
//
// UI button -> Quality mapping (see types.ts):
//   again -> 1   (forgot completely; reset, see again today)
//   hard  -> 3   (recalled with serious difficulty)
//   good  -> 4   (recalled, some hesitation)
//   easy  -> 5   (perfect, instant recall)

import type { Quality, ReviewButton, SchedulingState } from '../types'
import { addDays, todayKey } from './date'

/** Map a UI button to the SM-2 quality value. */
export const GRADE_BY_BUTTON: Record<ReviewButton, Quality> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
}

/** Default ease factor per SM-2. */
export const DEFAULT_EASE = 2.5

/**
 * Default interval schedule used by SM-2:
 *   1st success -> 1 day
 *   2nd success -> 6 days
 *   thereafter  -> round(prevInterval * ease)
 */
function intervalForRepetition(repetitions: number, ease: number, prevInterval: number): number {
  if (repetitions <= 1) return 1
  if (repetitions === 2) return 6
  return Math.max(1, Math.round(prevInterval * ease))
}

/**
 * Given the prior state and a review quality, return the new scheduling state.
 * `reviewedOn` defaults to today; pass a date key to backdate (mainly for tests).
 */
export function grade(
  prev: SchedulingState,
  quality: Quality,
  reviewedOn: string = todayKey(),
): SchedulingState {
  // Per SM-2: a quality < 3 means failure — reset repetitions to 0 and show
  // the card again today (interval 1).
  if (quality < 3) {
    return {
      ...prev,
      repetitions: 0,
      interval: 1,
      ease: nextEase(prev.ease, quality),
      due: addDays(reviewedOn, 1),
      lastReviewedAt: Date.now(),
    }
  }

  const repetitions = prev.repetitions + 1
  const interval = intervalForRepetition(repetitions, prev.ease, prev.interval)
  return {
    ...prev,
    repetitions,
    interval,
    ease: nextEase(prev.ease, quality),
    due: addDays(reviewedOn, interval),
    lastReviewedAt: Date.now(),
  }
}

/**
 * SM-2 ease update: EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02)), floored at 1.3.
 */
function nextEase(prevEase: number, quality: Quality): number {
  const q = quality
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  return Math.max(1.3, prevEase + delta)
}

/** Create a fresh (never-reviewed) SchedulingState for a card. */
export function initialState(cardId: string, seedDue: string = todayKey()): SchedulingState {
  return {
    cardId,
    ease: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    due: seedDue,
    lastReviewedAt: null,
  }
}
