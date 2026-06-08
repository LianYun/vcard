// localStorage persistence layer with versioned, validated keys.
//
// Responsibilities:
//  - Serialize/deserialize typed JSON under namespaced keys.
//  - Survive corrupt/missing data gracefully (reset to defaults rather than crash).
//  - All app code reads/writes through these functions; nothing else touches
//    localStorage directly.

import type { Card, LLMConfig, ProgressMap, Settings } from '../types'
import { initialState } from './sm2'
import { todayKey } from './date'

export const STORAGE_KEYS = {
  customCards: 'vibe-word:cards:v1',
  progress: 'vibe-word:progress:v1',
  settings: 'vibe-word:settings:v1',
  meta: 'vibe-word:meta:v1',
  llmConfig: 'vibe-word:llm:v1',
  hiddenBuiltins: 'vibe-word:hidden-builtins:v1',
} as const

export const DEFAULT_SETTINGS: Settings = {
  newCardsPerDay: 10,
}

/** Today's date key captured at load; overridable in tests. */
function nowKey(): string {
  return todayKey()
}

// --- generic read/write ----------------------------------------------------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    // Corrupt JSON — reset rather than propagate.
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled — ignore for now.
  }
}

// --- custom cards ----------------------------------------------------------

export function loadCustomCards(): Card[] {
  const cards = readJSON<Card[]>(STORAGE_KEYS.customCards, [])
  return cards.filter((c) => c && typeof c.id === 'string')
}

export function saveCustomCards(cards: Card[]): void {
  writeJSON(STORAGE_KEYS.customCards, cards)
}

// --- progress (per-card scheduling state) ----------------------------------

export function loadProgress(): ProgressMap {
  const map = readJSON<ProgressMap>(STORAGE_KEYS.progress, {})
  // Light validation: drop entries missing cardId.
  const clean: ProgressMap = {}
  for (const [cardId, state] of Object.entries(map)) {
    if (state && typeof state.cardId === 'string') {
      clean[cardId] = state
    }
  }
  return clean
}

export function saveProgress(progress: ProgressMap): void {
  writeJSON(STORAGE_KEYS.progress, progress)
}

/** Ensure a progress entry exists for the given card (new cards start due today). */
export function ensureProgress(progress: ProgressMap, cardId: string): ProgressMap {
  if (progress[cardId]) return progress
  return { ...progress, [cardId]: initialState(cardId, nowKey()) }
}

// --- settings --------------------------------------------------------------

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJSON<Partial<Settings>>(STORAGE_KEYS.settings, {}) }
}

export function saveSettings(settings: Settings): void {
  writeJSON(STORAGE_KEYS.settings, settings)
}

// --- meta (cross-session bookkeeping, e.g. new-cards-issued-today) ---------

export interface Meta {
  /** Date key when last new-cards budget was granted. */
  newCardsDate: string
  /** Number of new cards already issued on newCardsDate. */
  newCardsIssued: number
}

const DEFAULT_META: Meta = { newCardsDate: '', newCardsIssued: 0 }

export function loadMeta(): Meta {
  const meta = readJSON<Partial<Meta>>(STORAGE_KEYS.meta, {})
  return { ...DEFAULT_META, ...meta }
}

export function saveMeta(meta: Meta): void {
  writeJSON(STORAGE_KEYS.meta, meta)
}

// --- LLM config (OpenAI-compatible API credentials) ------------------------

export function loadLLMConfig(): LLMConfig | null {
  const cfg = readJSON<Partial<LLMConfig>>(STORAGE_KEYS.llmConfig, {})
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) return null
  return cfg as LLMConfig
}

export function saveLLMConfig(config: LLMConfig): void {
  writeJSON(STORAGE_KEYS.llmConfig, config)
}

// --- hidden built-in cards (soft-delete for static wordbank cards) ----------

export function loadHiddenBuiltins(): Set<string> {
  const ids = readJSON<string[]>(STORAGE_KEYS.hiddenBuiltins, [])
  return new Set(ids)
}

export function saveHiddenBuiltins(ids: Set<string>): void {
  writeJSON(STORAGE_KEYS.hiddenBuiltins, [...ids])
}

export function hideBuiltinCard(cardId: string): void {
  const hidden = loadHiddenBuiltins()
  hidden.add(cardId)
  saveHiddenBuiltins(hidden)
}
