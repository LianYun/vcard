import type { Card, Deck, StudyData } from '../types'
import { isNew } from './sm2'
export function ancestors(id: string, decks: Deck[]): string[] {
  const ids: string[] = []
  let next: string | undefined = id
  while (next && !ids.includes(next)) { ids.push(next); next = decks.find(d => d.id === next)?.parentId }
  return ids
}
export function deckPath(id: string, decks: Deck[]): string { return ancestors(id, decks).reverse().map(id => decks.find(d => d.id === id)?.name ?? id).join('::') }
export function inDeck(card: Card, id: string | null, decks: Deck[]): boolean { return !id || ancestors(card.deckId ?? 'default', decks).includes(id) }
export function selectFresh(cards: Card[], decks: Deck[], data: StudyData, limit: number, day: string): Card[] {
  const used = Object.fromEntries(Object.entries(data.deckIssued?.[day] ?? {}).map(([id, ids]) => [id, new Set(ids).size]))
  const groups = new Set<string>(), result: Card[] = []
  for (const card of cards) {
    if (result.length >= limit) break
    if (!isNew(data.progress[card.id]) || data.controls[card.id]?.suspended || (data.controls[card.id]?.buriedUntil ?? '') > day) continue
    const ids = ancestors(card.deckId ?? 'default', decks)
    if (ids.some(id => (used[id] ?? 0) >= (decks.find(d => d.id === id)?.newCardsPerDay ?? Infinity))) continue
    if (card.noteId && groups.has(card.noteId)) continue
    if (card.noteId) groups.add(card.noteId)
    result.push(card); ids.forEach(id => { used[id] = (used[id] ?? 0) + 1 })
  }
  return result
}
