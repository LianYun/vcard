import type { Card } from '../types'
import {
  deleteOneCard,
  loadCustomCards,
  saveOneCard,
  updateOneCard,
} from './storage'

export async function allCards(): Promise<Card[]> {
  return loadCustomCards()
}

export async function findCard(id: string): Promise<Card | undefined> {
  const cards = await allCards()
  return cards.find((c) => c.id === id)
}

export async function addCard(front: string, back: string, example?: string): Promise<Card> {
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
  }
  await saveOneCard(card)
  return card
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'front' | 'back' | 'example'>>,
): Promise<boolean> {
  const cards = await loadCustomCards()
  const existing = cards.find((c) => c.id === id)
  if (!existing) return false
  const front = patch.front?.trim() || existing.front
  const back = patch.back !== undefined ? patch.back.trim() : existing.back
  const example = patch.example !== undefined ? patch.example.trim() || null : existing.example ?? null
  return updateOneCard(id, front, back, example)
}

export async function deleteCard(id: string): Promise<boolean> {
  return deleteOneCard(id)
}
