// Storage layer: Tauri → SQLite (~/.vword/vword.db), browser → localStorage fallback.

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { Card, LLMConfig, ProgressMap, SchedulingState, Settings } from '../types'
import { createLogger } from './log'
import { initialState } from './sm2'
import { todayKey } from './date'

const log = createLogger('storage')
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
log.info('initialized', { mode: IS_TAURI ? 'tauri' : 'browser-localStorage' })

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  log.debug(`invoke → ${cmd}`, args)
  try {
    const result = await tauriInvoke<T>(cmd, args)
    log.debug(`invoke ← ${cmd}`, result)
    return result
  } catch (err) {
    log.error(`invoke ✗ ${cmd}`, err, { args })
    throw err
  }
}

// ── localStorage helpers (browser fallback) ─────────────────────────────

const LS_KEYS = {
  cards: 'vibe-word:cards:v1',
  progress: 'vibe-word:progress:v1',
  settings: 'vibe-word:settings:v1',
  meta: 'vibe-word:meta:v1',
  llmConfig: 'vibe-word:llm:v1',
  dailyStats: 'vibe-word:daily-stats:v1',
} as const

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

// ── Cards ───────────────────────────────────────────────────────────────

interface CardRow {
  id: string
  front: string
  back: string
  example: string | null
  created_at: number
}

function rowToCard(r: CardRow): Card {
  return {
    id: r.id,
    front: r.front,
    back: r.back,
    example: r.example ?? undefined,
    createdAt: r.created_at,
  }
}

export async function loadCustomCards(): Promise<Card[]> {
  if (IS_TAURI) {
    const rows = await invoke<CardRow[]>('get_cards')
    return rows.map(rowToCard)
  }
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  return cards.filter((c) => c && typeof c.id === 'string')
}

function cardToRow(c: Card): CardRow {
  return {
    id: c.id,
    front: c.front,
    back: c.back,
    example: c.example ?? null,
    created_at: c.createdAt ?? Math.floor(Date.now() / 1000),
  }
}

export async function saveCustomCards(cards: Card[]): Promise<void> {
  if (IS_TAURI) {
    for (const card of cards) {
      await invoke('save_card', { card: cardToRow(card) })
    }
    return
  }
  lsWrite(LS_KEYS.cards, cards)
}

export async function saveOneCard(card: Card): Promise<void> {
  if (IS_TAURI) {
    await invoke('save_card', { card: cardToRow(card) })
    return
  }
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  const idx = cards.findIndex((c) => c.id === card.id)
  if (idx >= 0) cards[idx] = card
  else cards.push(card)
  lsWrite(LS_KEYS.cards, cards)
}

export async function updateOneCard(
  id: string,
  front: string,
  back: string,
  example: string | null,
): Promise<boolean> {
  if (IS_TAURI) return invoke<boolean>('update_card', { id, front, back, example })
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  let changed = false
  const next = cards.map((c) => {
    if (c.id !== id) return c
    changed = true
    return { ...c, front, back, example: example || undefined }
  })
  if (changed) lsWrite(LS_KEYS.cards, next)
  return changed
}

export async function deleteOneCard(id: string): Promise<boolean> {
  if (IS_TAURI) return invoke<boolean>('delete_card', { id })
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  const next = cards.filter((c) => c.id !== id)
  if (next.length === cards.length) return false
  lsWrite(LS_KEYS.cards, next)
  return true
}

// ── Progress ────────────────────────────────────────────────────────────

interface ProgressRow {
  card_id: string
  ease: number
  interval: number
  repetitions: number
  due: string
  last_reviewed_at: number | null
}

function rowToState(r: ProgressRow): SchedulingState {
  return {
    cardId: r.card_id,
    ease: r.ease,
    interval: r.interval,
    repetitions: r.repetitions,
    due: r.due,
    lastReviewedAt: r.last_reviewed_at,
  }
}

function stateToRow(s: SchedulingState): ProgressRow {
  return {
    card_id: s.cardId,
    ease: s.ease,
    interval: s.interval,
    repetitions: s.repetitions,
    due: s.due,
    last_reviewed_at: s.lastReviewedAt,
  }
}

export async function loadProgress(): Promise<ProgressMap> {
  if (IS_TAURI) {
    const map = await invoke<Record<string, ProgressRow>>('get_progress')
    const result: ProgressMap = {}
    for (const [k, v] of Object.entries(map)) {
      result[k] = rowToState(v)
    }
    return result
  }
  const map = lsRead<ProgressMap>(LS_KEYS.progress, {})
  const clean: ProgressMap = {}
  for (const [cardId, state] of Object.entries(map)) {
    if (state && typeof state.cardId === 'string') clean[cardId] = state
  }
  return clean
}

export async function saveProgress(progress: ProgressMap): Promise<void> {
  if (IS_TAURI) {
    for (const state of Object.values(progress)) {
      await invoke('save_progress', { progress: stateToRow(state) })
    }
    return
  }
  lsWrite(LS_KEYS.progress, progress)
}

export async function saveOneProgress(state: SchedulingState): Promise<void> {
  if (IS_TAURI) {
    await invoke('save_progress', { progress: stateToRow(state) })
    return
  }
  const map = lsRead<ProgressMap>(LS_KEYS.progress, {})
  map[state.cardId] = state
  lsWrite(LS_KEYS.progress, map)
}

export async function deleteOneProgress(cardId: string): Promise<void> {
  if (IS_TAURI) {
    await invoke('delete_progress', { cardId })
    return
  }
  const map = lsRead<ProgressMap>(LS_KEYS.progress, {})
  delete map[cardId]
  lsWrite(LS_KEYS.progress, map)
}

export function ensureProgressSync(progress: ProgressMap, cardId: string): ProgressMap {
  if (progress[cardId]) return progress
  return { ...progress, [cardId]: initialState(cardId, todayKey()) }
}

// ── Settings ────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = { newCardsPerDay: 10 }

export async function loadSettings(): Promise<Settings> {
  if (IS_TAURI) {
    const val = await invoke<string | null>('get_setting', { key: 'new_cards_per_day' })
    return { newCardsPerDay: val ? parseInt(val, 10) : DEFAULT_SETTINGS.newCardsPerDay }
  }
  return { ...DEFAULT_SETTINGS, ...lsRead<Partial<Settings>>(LS_KEYS.settings, {}) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'new_cards_per_day', value: String(settings.newCardsPerDay) })
    return
  }
  lsWrite(LS_KEYS.settings, settings)
}

// ── Meta ────────────────────────────────────────────────────────────────

export interface Meta {
  newCardsDate: string
  newCardsIssued: number
}

const DEFAULT_META: Meta = { newCardsDate: '', newCardsIssued: 0 }

export async function loadMeta(): Promise<Meta> {
  if (IS_TAURI) {
    const all = await invoke<Record<string, string>>('get_all_settings')
    return {
      newCardsDate: all['meta_new_cards_date'] ?? '',
      newCardsIssued: all['meta_new_cards_issued'] ? parseInt(all['meta_new_cards_issued'], 10) : 0,
    }
  }
  const meta = lsRead<Partial<Meta>>(LS_KEYS.meta, {})
  return { ...DEFAULT_META, ...meta }
}

export async function saveMeta(meta: Meta): Promise<void> {
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'meta_new_cards_date', value: meta.newCardsDate })
    await invoke('set_setting', { key: 'meta_new_cards_issued', value: String(meta.newCardsIssued) })
    return
  }
  lsWrite(LS_KEYS.meta, meta)
}

// ── LLM Config ──────────────────────────────────────────────────────────

export async function loadLLMConfig(): Promise<LLMConfig | null> {
  if (IS_TAURI) {
    const all = await invoke<Record<string, string>>('get_all_settings')
    const baseURL = all['llm_base_url']
    const apiKey = all['llm_api_key']
    const model = all['llm_model']
    if (!baseURL || !apiKey || !model) return null
    return { baseURL, apiKey, model }
  }
  const cfg = lsRead<Partial<LLMConfig>>(LS_KEYS.llmConfig, {})
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) return null
  return cfg as LLMConfig
}

export async function saveLLMConfig(config: LLMConfig): Promise<void> {
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'llm_base_url', value: config.baseURL })
    await invoke('set_setting', { key: 'llm_api_key', value: config.apiKey })
    await invoke('set_setting', { key: 'llm_model', value: config.model })
    return
  }
  lsWrite(LS_KEYS.llmConfig, config)
}

// ── Daily Stats ─────────────────────────────────────────────────────────

export type DailyStatField = 'reviewed' | 'added'

export interface DailyStat {
  date: string  // YYYY-MM-DD
  reviewed: number
  added: number
}

export async function incrementDailyStat(field: DailyStatField, date: string): Promise<void> {
  if (IS_TAURI) {
    await invoke('increment_daily_stat', { date, field })
    return
  }
  const map = lsRead<Record<string, DailyStat>>(LS_KEYS.dailyStats, {})
  const cur = map[date] ?? { date, reviewed: 0, added: 0 }
  cur[field] += 1
  map[date] = cur
  lsWrite(LS_KEYS.dailyStats, map)
}

export async function getDailyStats(fromDate: string, toDate: string): Promise<DailyStat[]> {
  if (IS_TAURI) {
    return invoke<DailyStat[]>('get_daily_stats', { fromDate, toDate })
  }
  const map = lsRead<Record<string, DailyStat>>(LS_KEYS.dailyStats, {})
  return Object.values(map)
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}
