import { WORD_BANK } from '../data/wordbank'
import type { Card } from '../types'
import {
  hideBuiltinCard,
  loadCustomCards,
  loadHiddenBuiltins,
  saveCustomCards,
} from './storage'

/** All visible cards: built-in (minus hidden) then custom. */
export function allCards(): Card[] {
  const hidden = loadHiddenBuiltins()
  const builtins = WORD_BANK.filter((c) => !hidden.has(c.id))
  return [...builtins, ...loadCustomCards()]
}

/** Only the user-created cards (editable/deletable). */
export function customCards(): Card[] {
  return loadCustomCards()
}

/** Look up a single card by id across both sources. */
export function findCard(id: string): Card | undefined {
  return allCards().find((c) => c.id === id)
}

export function addCard(front: string, back: string, example?: string): Card {
  const cleanedFront = front.trim()
  const cleanedBack = back.trim()
  if (!cleanedFront) {
    throw new Error('单词（正面）不能为空')
  }
  const card: Card = {
    id: `custom:${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    front: cleanedFront,
    back: cleanedBack,
    example: example?.trim() || undefined,
    custom: true,
  }
  const cards = loadCustomCards()
  saveCustomCards([...cards, card])
  return card
}

export function updateCard(id: string, patch: Partial<Pick<Card, 'front' | 'back' | 'example'>>): boolean {
  const cards = loadCustomCards()
  let changed = false
  const next = cards.map((c) => {
    if (c.id !== id) return c
    changed = true
    return {
      ...c,
      front: patch.front?.trim() || c.front,
      back: patch.back !== undefined ? patch.back.trim() : c.back,
      example: patch.example !== undefined ? patch.example.trim() || undefined : c.example,
    }
  })
  if (changed) saveCustomCards(next)
  return changed
}

/** Delete a card. Custom cards are removed from storage; built-in cards are hidden. */
export function deleteCard(id: string): boolean {
  if (id.startsWith('builtin:')) {
    hideBuiltinCard(id)
    return true
  }
  const cards = loadCustomCards()
  const next = cards.filter((c) => c.id !== id)
  if (next.length === cards.length) return false
  saveCustomCards(next)
  return true
}
