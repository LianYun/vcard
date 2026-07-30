// Domain types for the vibe-word app.

/** A word card. */
export interface Card {
  /** Stable unique id, e.g. `custom:<timestamp>-<random>`. */
  id: string
  /** Front of the card — typically the foreign word. */
  front: string
  /** Back of the card — typically the meaning / definition. */
  back: string
  /** Example sentence, optional. */
  example?: string
  /** Unix timestamp (seconds) when the card was created. */
  createdAt?: number
}

/** Per-card scheduling state for the SuperMemo-2 algorithm. */
export interface SchedulingState {
  /** The card this state belongs to. */
  cardId: string
  /** Ease factor (difficulty), SM-2 default 2.5, floored at 1.3. */
  ease: number
  /** Current interval in days until next review. */
  interval: number
  /** Number of consecutive successful reviews. */
  repetitions: number
  /** ISO date string (YYYY-MM-DD) when the card is next due. */
  due: string
  /** ISO timestamp of last review, or null if never reviewed. */
  lastReviewedAt: number | null
}

/**
 * Review quality (q in SM-2, range 0–5). The UI exposes four buttons mapped onto
 * this scale. See GRADE_BY_BUTTON for the mapping.
 */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5

/** The four UI buttons. */
export type ReviewButton = 'again' | 'hard' | 'good' | 'easy'

/**
 * Persisted per-card progress. All SchedulingStates, keyed by cardId.
 * Stored under the storage key STORAGE_KEYS.progress.
 */
export type ProgressMap = Record<string, SchedulingState>

/** User settings (new cards per day budget). */
export interface Settings {
  /** Max new cards introduced per day. */
  newCardsPerDay: number
}

/** ISO date string in local time (YYYY-MM-DD). */
export type IsoDate = string

/** User-configured LLM API connection (OpenAI-compatible). */
export interface LLMConfig {
  /** API base URL, e.g. https://api.openai.com/v1 */
  baseURL: string
  /** API key / bearer token. */
  apiKey: string
  /** Model name, e.g. gpt-4o-mini, deepseek-chat. */
  model: string
}

/**
 * User-configured image-generation API connection (OpenAI-compatible
 * /images/generations). Kept separate from LLMConfig because image models often
 * live on a different provider or endpoint.
 */
export interface ImageGenConfig {
  /** API base URL, e.g. https://api.openai.com/v1 */
  baseURL: string
  /** API key / bearer token. */
  apiKey: string
  /** Image model name, e.g. dall-e-3, flux.1-dev. */
  model: string
}
