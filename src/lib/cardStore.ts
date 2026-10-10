import { normalizeTags } from './tags'
import type { Card } from '../types'
import {
  deleteOneCard,
  incrementDailyStat,
  loadCustomCards,
  saveOneCard,
  saveAcceptedImportCards,
  updateOneCard,
} from './storage'
import { todayKey } from './date'

export async function allCards(): Promise<Card[]> {
  return loadCustomCards()
}

export async function findCard(id: string): Promise<Card | undefined> {
  const cards = await allCards()
  return cards.find((c) => c.id === id)
}

export async function addCard(front: string, back: string, example?: string, noteId?: string, metadata?: Pick<Card, 'tags' | 'deckId'>): Promise<Card> {
  const cleanedFront = front.trim()
  const cleanedBack = back.trim()
  if (!cleanedFront) {
    throw new Error('卡片正面不能为空')
  }
  const card: Card = {
    id: `custom:${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    ...metadata,
    tags: normalizeTags(metadata?.tags),
    front: cleanedFront,
    noteId,
    back: cleanedBack,
    example: example?.trim() || undefined,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await saveOneCard(card)
  await incrementDailyStat('added', todayKey())
  return card
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'front' | 'back' | 'example' | 'tags'>>,
): Promise<boolean> {
  const cards = await loadCustomCards()
  const existing = cards.find((c) => c.id === id)
  if (!existing) return false
  if (existing.anki && ((patch.front !== undefined && patch.front !== existing.front) || (patch.back !== undefined && patch.back !== existing.back))) throw new Error('请使用“编辑 Anki 笔记”修改原始字段')
  const front = patch.front?.trim() || existing.front
  const back = patch.back !== undefined ? patch.back.trim() : existing.back
  const example = patch.example !== undefined ? patch.example.trim() || null : existing.example ?? null
  return updateOneCard(id, front, back, example, normalizeTags(patch.tags ?? existing.tags))
}

export async function deleteCard(id: string): Promise<boolean> {
  return deleteOneCard(id)
}

// Stable draft IDs make retries safe even if the app closes after saving the cards.
export async function acceptImportDraft(job: import('./importTypes').ImportJob, draft: import('./importTypes').ImportDraft): Promise<void> {
  if (!draft.cards) throw new Error('卡片尚未生成')
  const directions = job.reverse ? ['enToCn', 'cnToEn'] as const : ['enToCn'] as const
  await saveAcceptedImportCards(directions.map(direction => ({
    ...draft.cards![direction], id: `custom:import:${job.id}:${draft.id}:${direction}`,
    createdAt: Math.floor(job.createdAt / 1000), noteId: `note:import:${job.id}:${draft.id}`,
  })))
}
