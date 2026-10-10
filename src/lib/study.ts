import type { Card, CardControl, ProgressMap, ReviewRecord, StudyFilter, StudyData, Settings, StudyScope, Deck } from '../types'
import { selectFresh } from './decks'
import { addDays, todayKey } from './date'
import { matchesStudyScope } from './tags'
import type { Meta } from './storage'
import { isDue, isNew } from './sm2'

/** Randomize once per session, spacing sibling cards when the pool allows it. */
export function shuffleStudyCards(cards: Card[], random = Math.random): Card[] {
  const shuffled = [...cards]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  if (!shuffled.some((card, i) => i > 0 && card.noteId && card.noteId === shuffled[i - 1].noteId)) return shuffled

  const groups = new Map<string, Card[]>()
  for (const card of shuffled) {
    const key = card.noteId ? `note:${card.noteId}` : `card:${card.id}`
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  // Largest groups occupy alternating slots first; random input breaks ties.
  const result = new Array<Card>(cards.length)
  let index = 0
  for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
    for (const card of group) {
      if (index >= result.length) index = 1
      result[index] = card
      index += 2
    }
  }
  return result
}

export function available(control: CardControl | undefined, day = todayKey()): boolean {
  return !control?.suspended && (!control?.buriedUntil || control.buriedUntil <= day)
}
export function matchesStudy(card: Card, filter: StudyFilter, progress: ProgressMap,
  controls: Record<string, CardControl>, reviews: ReviewRecord[], now = Date.now()): boolean {
  const day = todayKey(new Date(now))
  switch (filter) {
    case 'due': return available(controls[card.id], day) && isDue(progress[card.id], now)
    case 'new': return isNew(progress[card.id])
    case 'suspended': return !!controls[card.id]?.suspended
    case 'marked': return !!controls[card.id]?.marked
    case 'forgotten': return reviews.some(r => r.cardId === card.id && !r.undone && r.quality < 3 && r.day >= addDays(day, -6))
    case 'recent': return card.createdAt != null && todayKey(new Date(card.createdAt * 1000)) >= addDays(day, -6)
    default: return true
  }
}
/** Future days are inclusive; today's backlog and minute learning are separate. */
export function aheadCards(cards: Card[], progress: ProgressMap, controls: Record<string, CardControl>, days: number, now = Date.now()): Card[] {
  if (!Number.isInteger(days) || days < 1 || days > 5) throw new Error('提前学习天数必须为 1–5')
  const today = todayKey(new Date(now)), end = addDays(today, days)
  return cards.filter(card => {
    const state = progress[card.id]
    return available(controls[card.id], today) && state?.lastReviewedAt != null && state.learningDue == null && state.due > today && state.due <= end
  }).sort((a, b) => progress[a.id].due.localeCompare(progress[b.id].due) || a.id.localeCompare(b.id))
}
export const FILTERS: { value: StudyFilter; label: string }[] = [
  {value:'all', label:'全部'}, {value:'due', label:'已到期'}, {value:'new', label:'新卡'},
  {value:'marked', label:'标记卡'}, {value:'forgotten', label:'最近 7 天忘记'},
  {value:'recent', label:'最近 7 天新增'}, {value:'suspended', label:'已暂停'},
]

/** Read-only selection shared by preview and session creation. */
export function selectStudyCards(all: Card[], data: StudyData, settings: Settings, meta: Meta, scope: StudyScope, decks: Deck[] = []) {
  const matching = all.filter(card => matchesStudyScope(card, scope))
  const cards = matching.filter(card => available(data.controls[card.id]))
  const budget = Math.max(0, settings.newCardsPerDay - (meta.newCardsDate === todayKey() ? meta.newCardsIssued : 0))
  const groups = new Set<string>()
  const fresh = cards.filter(card => isNew(data.progress[card.id])).filter(card => {
    if (!card.noteId) return true
    if (groups.has(card.noteId)) return false
    groups.add(card.noteId)
    return true
  })
  const reviews = cards.filter(card => !isNew(data.progress[card.id]) && (isDue(data.progress[card.id]) || data.progress[card.id].learningDue != null))
  return { matching, reviews, fresh: selectFresh(fresh, decks, data, budget, todayKey()), freshCount: fresh.length, budget }
}
