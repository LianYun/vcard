import type { Card } from '../types'
import type { ModelMessage } from './llm'
export interface ImportSection { id: string; label: string; text: string; imageId?: string }
export interface ImportedDocument { name: string; sections: ImportSection[]; warnings: string[] }
export interface ImportDraft {
  id: string
  word: string
  source: ImportSection
  quote: string
  prompt: ModelMessage[]
  status: 'queued' | 'ready' | 'failed' | 'accepted' | 'deleted'
  cards?: { enToCn: Card; cnToEn: Card }
  error?: string
  duplicate?: boolean
}
export interface ImportJob {
  version: 1
  id: string
  createdAt: number
  document: ImportedDocument
  target: number
  reverse: boolean
  guidance: string
  chunks: ImportSection[]
  analyzed: number
  drafts: ImportDraft[]
  status: 'analyzing' | 'generating' | 'paused' | 'review' | 'failed'
  error?: string
}
