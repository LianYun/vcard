import type { Card, StudyData } from '../types'
import { todayKey } from './date'

// Project each learned card's next scheduled appearance, never simulated reviews.
export function calendarForecast(cards: Card[], data: StudyData, today: string): Map<string, Card[]> {
    const result = new Map<string, Card[]>()
    for (const card of cards) {
      const state = data.progress[card.id], control = data.controls[card.id]
      if (!state || state.lastReviewedAt == null || control?.suspended) continue
      let day = state.learningDue != null ? todayKey(new Date(state.learningDue)) : state.due
      if (day < today) day = today
      if (control?.buriedUntil && control.buriedUntil > day) day = control.buriedUntil
      const bucket = result.get(day) ?? []
      bucket.push(card)
      result.set(day, bucket)
    }
    return result
}
