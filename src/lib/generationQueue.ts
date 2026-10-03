// In-memory background generation queue.
// Users enqueue words; workers (up to MAX_CONCURRENCY) call the LLM in parallel.
// On success the two generated cards are persisted and their progress is seeded.
// Subscribers are notified on every state change (for useSyncExternalStore).

import type { LLMConfig } from '../types'
import { addCard } from './cardStore'
import { generateCardsWithImage } from './llm'
import { ensureProgressSync, loadImageGenConfig, loadProgress, saveOneProgress } from './storage'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationTask {
  id: string
  word: string
  status: TaskStatus
  enqueuedAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  resultCardIds?: [string, string]
}

const MAX_CONCURRENCY = 3
const KEEP_TERMINAL_MS = 5 * 60 * 1000  // keep done/failed for 5 minutes

type Listener = () => void
type CompletionListener = () => void

class GenerationQueue {
  private tasks: GenerationTask[] = []
  private listeners = new Set<Listener>()
  private completionListeners = new Set<CompletionListener>()
  private configs = new Map<string, LLMConfig>()
  private aborts = new Map<string, AbortController>()

  // Reference-stable snapshot for useSyncExternalStore.
  private snapshot: GenerationTask[] = []

  constructor() {
    if (typeof window !== 'undefined') {
      setInterval(() => this.pruneTerminal(), 30_000)
    }
  }

  getSnapshot = (): GenerationTask[] => this.snapshot

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Subscribe to "task done successfully" events (for refreshing card lists). */
  onCompleted = (cb: CompletionListener): (() => void) => {
    this.completionListeners.add(cb)
    return () => { this.completionListeners.delete(cb) }
  }

  enqueue = (word: string, llmConfig: LLMConfig): GenerationTask => {
    const task: GenerationTask = {
      id: `gen:${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      word: word.trim(),
      status: 'queued',
      enqueuedAt: Date.now(),
    }
    this.configs.set(task.id, { ...llmConfig })
    this.tasks.push(task)
    this.notify()
    this.kick()
    return task
  }

  cancel = (id: string): void => {
    const task = this.tasks.find((t) => t.id === id)
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return
    const ac = this.aborts.get(id)
    if (ac) ac.abort()
    if (task.status === 'queued' || task.status === 'running') {
      task.status = 'failed'
      task.error = '已取消'
      task.finishedAt = Date.now()
    }
    this.configs.delete(id)
    this.notify()
    this.kick()
  }

  private runningCount(): number {
    return this.aborts.size
  }

  private kick(): void {
    while (this.runningCount() < MAX_CONCURRENCY) {
      const next = this.tasks.find((t) => t.status === 'queued')
      if (!next) return
      this.run(next, this.configs.get(next.id)!)
    }
  }

  private async run(task: GenerationTask, llmConfig: LLMConfig): Promise<void> {
    task.status = 'running'
    task.startedAt = Date.now()
    const ac = new AbortController()
    this.aborts.set(task.id, ac)
    this.notify()

    try {
      // Lazy-load image config per run so setting changes take effect immediately
      // (no stale reference held in the queue).
      const imageConfig = await loadImageGenConfig()
      const result = await generateCardsWithImage(task.word, llmConfig, imageConfig, ac.signal)
      ac.signal.throwIfAborted()
      const card1 = await addCard(result.enToCn.front, result.enToCn.back, result.enToCn.example)
      const card2 = await addCard(result.cnToEn.front, result.cnToEn.back, result.cnToEn.example)

      let progress = await loadProgress()
      progress = ensureProgressSync(progress, card1.id)
      progress = ensureProgressSync(progress, card2.id)
      await saveOneProgress(progress[card1.id])
      await saveOneProgress(progress[card2.id])

      task.status = 'done'
      task.finishedAt = Date.now()
      task.resultCardIds = [card1.id, card2.id]
      this.completionListeners.forEach((cb) => cb())
    } catch (err) {
      // If the abort was the cause, cancel() already set status; don't overwrite.
      if ((task.status as TaskStatus) !== 'failed') {
        task.status = 'failed'
        task.error = err instanceof Error ? err.message : String(err)
        task.finishedAt = Date.now()
      }
    } finally {
      this.aborts.delete(task.id)
      this.configs.delete(task.id)
      this.notify()
      this.kick()
    }
  }

  private pruneTerminal(): void {
    const now = Date.now()
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => {
      if (t.status !== 'done' && t.status !== 'failed') return true
      return (t.finishedAt ?? now) + KEEP_TERMINAL_MS > now
    })
    if (this.tasks.length !== before) this.notify()
  }

  private notify(): void {
    this.snapshot = [...this.tasks]
    this.listeners.forEach((cb) => cb())
  }
}

export const generationQueue = new GenerationQueue()
