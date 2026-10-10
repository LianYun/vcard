// Domain types for the vibe-word app.

/** A word card. */
export interface Card {
  /** Stable unique id, e.g. `custom:<timestamp>-<random>`. */
  id: string
  /** Front of the card — typically the foreign word. */
  deckId?: string
  anki?: AnkiNote
  front: string
  /** Back of the card — typically the meaning / definition. */
  back: string
  /** User labels; older cards without tags are untagged. */
  tags?: string[]
  noteId?: string
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
  phase?: 'new' | 'learning' | 'review' | 'relearning'
  learningDue?: number | null
  learningStep?: number
  issuedAt?: string
  fsrs?: MemoryState
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
/** null = all cards; [] = no selection; empty tag = untagged. */
export type StudyScope = string[] | null

export interface Settings {
  studyScope?: StudyScope
  /** Max new cards introduced per day. */
  newCardsPerDay: number
}

/** ISO date string in local time (YYYY-MM-DD). */
export type IsoDate = string

/** User-configured LLM API connection (OpenAI-compatible). */
export interface LLMConfig {
  /** User-confirmed support for image_url chat inputs. */
  supportsImages?: boolean
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

export interface CardControl { suspended?: boolean; buriedUntil?: string; buriedBy?: string; marked?: boolean }
export interface ReviewRecord {
  id: string; cardId: string; timestamp: number; day: string; quality: Quality;
  before: SchedulingState; after: SchedulingState; algorithm: string; undone?: boolean; schedulerConfig?: SchedulerConfig
}
/** Small commit reply; grading does not reload the library or review history. */
export interface ReviewCommit extends SchedulingState {
  reviewId: string
  controlUpdates: Record<string, CardControl>
  record: ReviewRecord
  revision?: number
}
export interface StudyData {
  schedulerConfig?: SchedulerConfig;
  rescheduledAt?: Record<string, number>;
  deckIssued?: Record<string, Record<string, string[]>>;
  controls: Record<string, CardControl>; reviews: ReviewRecord[];
  progress: ProgressMap; issued: Record<string, string[]>;
}
export type StudyFilter = 'all' | 'due' | 'new' | 'suspended' | 'marked' | 'forgotten' | 'recent'

export interface Deck { id: string; name: string; parentId?: string; newCardsPerDay?: number }
export interface AnkiNote { guid: string; model: string; fields: Record<string, string>; question: string; answer: string; css: string; ordinal: number; cloze: boolean }

export interface MemoryState {
  version: 6; stability: number; difficulty: number; lapses: number;
  source: 'new' | 'history' | 'partial' | 'estimated'; parametersId: string;
}
export interface SchedulerConfig {
  version: 6; id: string; retention: number; maximumInterval: number;
  learningSteps: number[]; relearningSteps: number[]; weights: number[];
  optimizedAt?: number;
}
export interface ReviewContext { now: number; configId: string; before: SchedulingState }
export interface OptimizationResult {
  config: SchedulerConfig; samples: number; training: number; validation: number;
  baselineLoss: number; candidateLoss: number; accepted: boolean;
}
