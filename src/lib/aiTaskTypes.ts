import type { Card } from '../types'
import type { ImportedDocument, ImportSection } from './importTypes'
import type { ModelMessage } from './llm'

export type TaskStatus = 'queued' | 'running' | 'paused' | 'review' | 'done' | 'failed' | 'cancelled'
export interface CardDraft {
  id: string
  direction: 'enToCn' | 'cnToEn' | 'replacement'
  card: Card
  status: 'ready' | 'accepted' | 'discarded'
  source?: ImportSection
  quote?: string
  revision: number
}
export interface GenerationTask {
  id: string
  kind: 'word' | 'document' | 'replacement' | 'draft'
  word: string
  requirements: string
  status: TaskStatus
  enqueuedAt: number
  startedAt?: number
  finishedAt?: number
  model?: string
  error?: string
  warning?: string
  expected?: Card
  context?: { source: ImportSection; quote?: string }
  targetDraft?: { taskId: string; draftId: string; revision: number }
  drafts: CardDraft[]
  document?: { document: ImportedDocument; target: number; reverse: boolean; analyzed: number; candidates: { id: string; word: string; source: ImportSection; quote: string; prompt: ModelMessage[]; completed?: boolean }[] }
}
export interface AITaskState { version: 1; tasks: GenerationTask[]; migratedImports?: boolean }
