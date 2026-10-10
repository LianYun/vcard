// Storage layer: Tauri → SQLite (~/.vword/vword.db), browser → localStorage fallback.

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { Card, ImageGenConfig, LLMConfig, ProgressMap, SchedulingState, Settings } from '../types'
import { createLogger } from './log'
import { initialState } from './sm2'
import { DEFAULT_SCHEDULER, FSRS_ALGORITHM, fsrsPreview, migrateState, validateConfig, rescheduleProjection } from './fsrs'
import type { SchedulerConfig, ReviewContext } from '../types'
import type { Quality, StudyData, CardControl, ReviewCommit, ReviewRecord, StudyScope } from '../types'
import { normalizeTags, normalizeStudyScope } from './tags'
import { todayKey, addDays } from './date'
import { ancestors, selectFresh } from './decks'
import type { Deck } from '../types'

const log = createLogger('storage')
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
log.info('initialized', { mode: IS_TAURI ? 'tauri' : 'browser-localStorage' })

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  log.debug(`invoke → ${cmd}`)
  try {
    const result = await tauriInvoke<T>(cmd, args)
    log.debug(`invoke ← ${cmd}`)
    return result
  } catch (err) {
    log.error(`invoke ✗ ${cmd}`, err)
    throw err
  }
}

// macOS and iOS use the same open JSON event store and folder synchronization.
let nativeStorage: Promise<boolean> | undefined
function usesNativeStorage(): Promise<boolean> {
  if (!IS_TAURI) return Promise.resolve(false)
  return nativeStorage ??= invoke<boolean>('native_cloud_storage')
}
function cloud<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>('cloud_storage', { command, args })
}
export interface CloudStatus { needsAuthorization?: boolean; enabled: boolean; revision: number; syncRevision?: number; message: string; folder: string }
export async function loadCloudStatus(check = false): Promise<CloudStatus | null> {
  return await usesNativeStorage() ? cloud(check ? 'check' : 'status') : null
}
export async function authorizeCloudSync(): Promise<CloudStatus | null> {
  return await usesNativeStorage() ? cloud('authorizeSync', { interfaceLanguage: loadLanguage() }) : null
}
export async function fileStorageAction(action: 'importCards' | 'exportCards'): Promise<number | null> {
  if (!await usesNativeStorage()) throw new Error('此功能需要 Mac 应用')
  return cloud(action, { interfaceLanguage: loadLanguage() })
}
export async function issueNewCards(ids: string[]): Promise<string[]> { return studyTransaction(()=>issueCards(ids)) }
export interface StudySessionStart {
  cards: Card[]
  data: StudyData
  emptyReason: string
  timings: Record<string, number>
}
// Selection and issuance share one native transaction; only the selected cards cross IPC.
export async function startNativeStudy(scope: StudyScope, ahead: number, deckId: string | null): Promise<StudySessionStart | null> {
  if (!await usesNativeStorage()) return null
  return studyTransaction(() => cloud('startStudy', { scope, ahead, deckId }))
}
async function issueCards(ids: string[]): Promise<string[]> {
  if (await usesNativeStorage()) return cloud('issue', { ids })
  const data = await loadStudyData(), settings = await loadSettings(), meta = await loadMeta()
  const day = todayKey(), used = meta.newCardsDate === day ? meta.newCardsIssued : 0
  const cards = await loadCustomCards(), decks = await loadDecks()
  const ordered = [...new Set(ids)].flatMap(id => cards.filter(c => c.id === id))
  const accepted = selectFresh(ordered, decks, data, Math.max(0, settings.newCardsPerDay - used), day).map(c => c.id)
  data.deckIssued ??= {}; data.deckIssued[day] ??= {}
  for (const id of accepted) for (const deck of ancestors(cards.find(c => c.id === id)?.deckId ?? 'default', decks)) {
    data.deckIssued[day][deck] = [...new Set([...(data.deckIssued[day][deck] ?? []), id])]
  }
  for (const id of accepted) data.progress[id] = { ...(data.progress[id] ?? initialState(id)), issuedAt: day, phase: 'new' }
  data.issued[day] = [...new Set([...(data.issued[day] ?? []), ...accepted])]
  await writeStudyData(data)
  return accepted
}
export async function recordReview(state: SchedulingState, quality: Quality, context?: ReviewContext): Promise<ReviewCommit> { return studyTransaction(()=>writeReview(state,quality,context)) }
async function writeReview(state: SchedulingState, quality: Quality, context?: ReviewContext): Promise<ReviewCommit> {
  if (await usesNativeStorage()) return cloud<ReviewCommit>('review', { id: state.cardId, quality, context })
  const data = await loadStudyData(), cards = await loadCustomCards()
  const card = cards.find(c => c.id === state.cardId)
  if (!card) throw new Error('卡片已删除，请重新检查')
  const config = data.schedulerConfig ?? DEFAULT_SCHEDULER
  const before = migrateState(data.progress[state.cardId] ?? state, data.reviews, config)
  if (context && (context.configId !== config.id || JSON.stringify(context.before) !== JSON.stringify(before) || context.now > Date.now()+60000 || context.now < Date.now()-120000)) throw new Error('学习状态已变化，请重新检查')
  const timestamp = context?.now ?? Date.now(), day = todayKey(new Date(timestamp))
  const control = data.controls[state.cardId]
  if (control?.suspended || (control?.buriedUntil && control.buriedUntil > day)) throw new Error('卡片已暂停或今天跳过')
  const next = fsrsPreview(before, config, timestamp)[quality]
  if (!data.reviews.some(r=>r.algorithm===FSRS_ALGORITHM)) await backupBeforeFSRS(data)
  data.progress[state.cardId] = next
  const reviewId = crypto.randomUUID()
  const record: ReviewRecord = {id: reviewId, cardId: state.cardId, before, after: next, quality, timestamp, day, algorithm: FSRS_ALGORITHM, schedulerConfig: config}
  data.reviews.push(record)
  const controlUpdates: Record<string, CardControl> = {}
  if (card.noteId) for (const sibling of cards.filter(c => c.id !== card.id && c.noteId === card.noteId)) {
    if(!data.controls[sibling.id]?.buriedUntil || data.controls[sibling.id].buriedUntil!<=day) {
      data.controls[sibling.id] = { ...data.controls[sibling.id], buriedUntil: addDays(day, 1), buriedBy:reviewId }
      controlUpdates[sibling.id] = data.controls[sibling.id]
    }
  }
  await writeStudyData(data)
  return {...next,reviewId,controlUpdates,record}
}
let studyWrites: Promise<unknown> = Promise.resolve()
function studyTransaction<T>(operation:()=>Promise<T>):Promise<T> {
  const next = studyWrites.catch(()=>{}).then(async ():Promise<T>=>{
    // Native transactions are already serialized by the shared storage worker.
    if(!await usesNativeStorage() && typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('vibe-word-study',async()=>await operation())
    return await operation()
  })
  studyWrites=next
  return next
}
const STUDY_KEY = 'vibe-word:study:v3'
const LEGACY_STUDY_KEY = 'vibe-word:study:v2'
async function storedStudy(): Promise<StudyData> {
  if (!IS_TAURI) recoverAICommit()
  const raw = IS_TAURI ? await invoke<string | null>('get_setting', {key: STUDY_KEY}) ?? await invoke<string | null>('get_setting', {key: LEGACY_STUDY_KEY}) : localStorage.getItem(STUDY_KEY) ?? localStorage.getItem(LEGACY_STUDY_KEY)
  if (!raw) return {controls: {}, reviews: [], progress: {}, issued: {}}
  const value = JSON.parse(raw) as StudyData
  if(value.schedulerConfig) validateConfig(value.schedulerConfig)
  if (!value.controls || !Array.isArray(value.reviews) || !value.progress || !value.issued) throw new Error('学习记录损坏，请从备份恢复')
  return value
}
async function writeStudyData(data: StudyData): Promise<void> {
  autoBackup()
  if (IS_TAURI) await invoke('set_setting', {key: STUDY_KEY, value: JSON.stringify(data)})
  else lsWrite(STUDY_KEY, data)
}
export async function loadStudyData(options: { cardIds?: string[]; includeReviews?: boolean } = {}): Promise<StudyData> {
  if (await usesNativeStorage()) return cloud('studyData', { ids: options.cardIds, includeReviews: options.includeReviews })
  const data = await storedStudy()
  data.progress = {...await rawProgress(), ...data.progress}
  const config = data.schedulerConfig ?? DEFAULT_SCHEDULER
  const histories = new Map<string, ReviewRecord[]>()
  for(const record of data.reviews) { const list=histories.get(record.cardId)??[]; list.push(record);histories.set(record.cardId,list) }
  for(const [id,state] of Object.entries(data.progress)) {
    const m=state.fsrs
    if(m&&(m.version!==6||!Number.isFinite(m.stability)||m.stability<.001||m.stability>36500||!Number.isFinite(m.difficulty)||m.difficulty<1||m.difficulty>10)) throw new Error('FSRS 记忆状态无效')
    data.progress[id]=migrateState(state,histories.get(id)??[],config)
  }
  if (options.includeReviews === false) data.reviews = []
  if (options.cardIds) {
    const ids = new Set(options.cardIds)
    data.progress = Object.fromEntries(Object.entries(data.progress).filter(([id]) => ids.has(id)))
    data.controls = Object.fromEntries(Object.entries(data.controls).filter(([id]) => ids.has(id)))
  }
  return data
}
export async function loadReviewHistory(cardId: string): Promise<ReviewRecord[]> {
  if (await usesNativeStorage()) return cloud('reviewHistory', { id: cardId })
  return (await loadStudyData()).reviews.filter(record => record.cardId === cardId).slice(-20).reverse()
}
export async function setCardControl(id: string, patch: CardControl): Promise<void> { return studyTransaction(()=>writeControl(id,patch)) }
async function writeControl(id: string, patch: CardControl): Promise<void> {
  const data = await loadStudyData(), control = {...data.controls[id], ...patch, ...(patch.buriedUntil!==undefined?{buriedBy:''}:{})}
  if (await usesNativeStorage()) return cloud('control', {id, control})
  data.controls[id] = control
  await writeStudyData(data)
  if(typeof window !== 'undefined') window.dispatchEvent(new Event('vibe-library-changed'))
}
export async function undoReview(id: string): Promise<void> { return studyTransaction(()=>undoRating(id)) }
async function undoRating(id: string): Promise<void> {
  if (await usesNativeStorage()) return cloud('undoReview', {id})
  const data = await loadStudyData(), record = data.reviews.find(r => r.id === id)
  if(record && !(await loadCustomCards()).some(c=>c.id===record.cardId)) throw new Error('卡片已删除，无法撤销')
  if (!record || (data.rescheduledAt?.[record.cardId] ?? 0) >= record.timestamp || record.undone || data.reviews.filter(r => r.cardId === record.cardId && !r.undone).slice(-1)[0]?.id !== id)
    throw new Error('这张卡已有新的评分，无法撤销')
  record.undone = true
  for(const control of Object.values(data.controls)) if(control.buriedBy===id){delete control.buriedUntil;delete control.buriedBy}
  data.progress[record.cardId] = record.before
  await writeStudyData(data)
}

// ── localStorage helpers (browser fallback) ─────────────────────────────

const LS_KEYS = {
  cards: 'vibe-word:cards:v1',
  progress: 'vibe-word:progress:v1',
  settings: 'vibe-word:settings:v1',
  meta: 'vibe-word:meta:v1',
  llmConfig: 'vibe-word:llm:v1',
  imageConfig: 'vibe-word:image-gen:v1',
  dailyStats: 'vibe-word:daily-stats:v1',
} as const

function lsRead<T>(key: string, fallback: T): T {
  recoverAICommit()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function lsWrite(key: string, value: unknown): void {
  recoverAICommit()
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { throw new Error('本地保存失败，存储空间可能不足，请导出备份后清理空间') }
}

// ── Cards ───────────────────────────────────────────────────────────────

interface CardRow {
  deck_id?: string
  note_id?: string
  anki?: Card['anki']
  tags?: string[]
  id: string
  front: string
  back: string
  example: string | null
  created_at: number
}

function rowToCard(r: CardRow): Card {
  return {
    deckId: r.deck_id, noteId: r.note_id, anki: r.anki,
    tags: normalizeTags(r.tags),
    id: r.id,
    front: r.front,
    back: r.back,
    example: r.example ?? undefined,
    createdAt: r.created_at,
  }
}

export async function loadCustomCards(): Promise<Card[]> {
  if (await usesNativeStorage()) return cloud('cards')
  if (IS_TAURI) {
    const rows = await invoke<CardRow[]>('get_cards')
    return rows.map(rowToCard)
  }
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  return cards.filter((c) => c && typeof c.id === 'string')
}

function cardToRow(c: Card): CardRow {
  return {
    deck_id: c.deckId, note_id: c.noteId, anki: c.anki,
    tags: normalizeTags(c.tags),
    id: c.id,
    front: c.front,
    back: c.back,
    example: c.example ?? null,
    created_at: c.createdAt ?? Math.floor(Date.now() / 1000),
  }
}

export async function saveCustomCards(cards: Card[]): Promise<void> {
  if (await usesNativeStorage()) return cloud('saveCards', { cards })
  if (IS_TAURI) {
    for (const card of cards) {
      await invoke('save_card', { card: cardToRow(card) })
    }
    return
  }
  lsWrite(LS_KEYS.cards, cards)
}

export async function saveOneCard(card: Card): Promise<void> {
  if (await usesNativeStorage()) return cloud('saveCards', { cards: [card] })
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
  tags: string[],
): Promise<boolean> {
  if (await usesNativeStorage()) return cloud('updateCard', { id, front, back, example, tags })
  if (IS_TAURI) return invoke<boolean>('update_card', { id, front, back, example, tags })
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  let changed = false
  const next = cards.map((c) => {
    if (c.id !== id) return c
    changed = true
    return { ...c, front, back, example: example || undefined, tags }
  })
  if (changed) lsWrite(LS_KEYS.cards, next)
  return changed
}

export async function deleteOneCard(id: string): Promise<boolean> {
  if (await usesNativeStorage()) return cloud('deleteCard', { id })
  // SQLite deletes progress through its ON DELETE CASCADE foreign key.
  if (IS_TAURI) { const removed = await invoke<boolean>('delete_card', { id }); if(removed) await deleteOneProgress(id); return removed }
  const cards = lsRead<Card[]>(LS_KEYS.cards, [])
  const next = cards.filter((c) => c.id !== id)
  if (next.length === cards.length) return false
  lsWrite(LS_KEYS.cards, next)
  await deleteOneProgress(id)
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

export async function loadProgress(): Promise<ProgressMap> { return (await loadStudyData()).progress }
async function rawProgress(): Promise<ProgressMap> {
  if (await usesNativeStorage()) return cloud('progress')
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
  if (await usesNativeStorage()) return cloud('seed', { states: Object.values(progress) })
  if (IS_TAURI) {
    for (const state of Object.values(progress)) {
      await invoke('save_progress', { progress: stateToRow(state) })
    }
    return
  }
  lsWrite(LS_KEYS.progress, progress)
}

export async function saveOneProgress(state: SchedulingState): Promise<void> {
  if (await usesNativeStorage()) return cloud('seed', { states: [state] })
  if (IS_TAURI) {
    await invoke('save_progress', { progress: stateToRow(state) })
    return
  }
  const map = lsRead<ProgressMap>(LS_KEYS.progress, {})
  map[state.cardId] = state
  lsWrite(LS_KEYS.progress, map)
}

export async function deleteOneProgress(cardId: string): Promise<void> {
  if (await usesNativeStorage()) return // Card deletion removes progress in the shared projection.
  const study = await storedStudy(); delete study.progress[cardId]; delete study.controls[cardId]; await writeStudyData(study)
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
  if (await usesNativeStorage()) {
    const settings = await cloud<Settings>('settings')
    return { ...settings, studyScope: normalizeStudyScope(settings.studyScope) }
  }
  if (IS_TAURI) {
    const val = await invoke<string | null>('get_setting', { key: 'new_cards_per_day' })
    const scope = await invoke<string | null>('get_setting', { key: 'study_scope' })
    return { newCardsPerDay: val ? parseInt(val, 10) : DEFAULT_SETTINGS.newCardsPerDay, studyScope: scope ? normalizeStudyScope(JSON.parse(scope)) : null }
  }
  const settings = { ...DEFAULT_SETTINGS, ...lsRead<Partial<Settings>>(LS_KEYS.settings, {}) }
  return { ...settings, studyScope: normalizeStudyScope(settings.studyScope) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (await usesNativeStorage()) return cloud('saveSettings', { limit: settings.newCardsPerDay, studyScope: settings.studyScope ?? null })
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'new_cards_per_day', value: String(settings.newCardsPerDay) })
    await invoke('set_setting', { key: 'study_scope', value: JSON.stringify(settings.studyScope ?? null) })
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
  if (await usesNativeStorage()) return cloud('meta')
  const old = await legacyMeta(), data = await storedStudy(), day = todayKey()
  return {newCardsDate: day, newCardsIssued: (old.newCardsDate === day ? old.newCardsIssued : 0) + (data.issued[day]?.length ?? 0)}
}
async function legacyMeta(): Promise<Meta> {
  if (await usesNativeStorage()) return cloud('meta')
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
  if (await usesNativeStorage()) return // Native issueNewCards persists per-card issuance atomically.
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'meta_new_cards_date', value: meta.newCardsDate })
    await invoke('set_setting', { key: 'meta_new_cards_issued', value: String(meta.newCardsIssued) })
    return
  }
  lsWrite(LS_KEYS.meta, meta)
}

// ── LLM Config ──────────────────────────────────────────────────────────

export async function loadLLMConfig(): Promise<LLMConfig | null> {
  if (await usesNativeStorage()) {
    const config = await cloud<LLMConfig>('llm')
    return config.baseURL && config.apiKey && config.model ? config : null
  }
  if (IS_TAURI) {
    const all = await invoke<Record<string, string>>('get_all_settings')
    const baseURL = all['llm_base_url']
    const apiKey = all['llm_api_key']
    const model = all['llm_model']
    if (!baseURL || !apiKey || !model) return null
    return { baseURL, apiKey, model, supportsImages: all['llm_supports_images'] === 'true' }
  }
  const cfg = lsRead<Partial<LLMConfig>>(LS_KEYS.llmConfig, {})
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) return null
  return cfg as LLMConfig
}

export async function saveLLMConfig(config: LLMConfig): Promise<void> {
  if (await usesNativeStorage()) return cloud('saveLLM', { config })
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'llm_base_url', value: config.baseURL })
    await invoke('set_setting', { key: 'llm_api_key', value: config.apiKey })
    await invoke('set_setting', { key: 'llm_model', value: config.model })
    await invoke('set_setting', { key: 'llm_supports_images', value: String(config.supportsImages === true) })
    return
  }
  lsWrite(LS_KEYS.llmConfig, config)
}

// ── Image Generation Config ─────────────────────────────────────────────

export async function loadImageGenConfig(): Promise<ImageGenConfig | null> {
  if (await usesNativeStorage()) {
    const config = await cloud<ImageGenConfig>('image')
    return config.baseURL && config.apiKey && config.model ? config : null
  }
  if (IS_TAURI) {
    const all = await invoke<Record<string, string>>('get_all_settings')
    const baseURL = all['image_base_url']
    const apiKey = all['image_api_key']
    const model = all['image_model']
    if (!baseURL || !apiKey || !model) return null
    return { baseURL, apiKey, model }
  }
  const cfg = lsRead<Partial<ImageGenConfig>>(LS_KEYS.imageConfig, {})
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) return null
  return cfg as ImageGenConfig
}

export async function saveImageGenConfig(config: ImageGenConfig): Promise<void> {
  if (await usesNativeStorage()) return cloud('saveImage', { config })
  if (IS_TAURI) {
    await invoke('set_setting', { key: 'image_base_url', value: config.baseURL })
    await invoke('set_setting', { key: 'image_api_key', value: config.apiKey })
    await invoke('set_setting', { key: 'image_model', value: config.model })
    return
  }
  lsWrite(LS_KEYS.imageConfig, config)
}

// ── Daily Stats ─────────────────────────────────────────────────────────

export type DailyStatField = 'reviewed' | 'added'

export interface DailyStat {
  date: string  // YYYY-MM-DD
  reviewed: number
  added: number
}

export async function incrementDailyStat(field: DailyStatField, date: string): Promise<void> {
  if (await usesNativeStorage()) return // Native add/review already includes statistics in its transaction.
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
  if (await usesNativeStorage()) return cloud('stats', {from: fromDate, to: toDate})
  const base = await legacyStats(fromDate, toDate), data = await storedStudy()
  const map = Object.fromEntries(base.map(s => [s.date, s]))
  for (const r of data.reviews.filter(r => !r.undone && r.day >= fromDate && r.day <= toDate)) {
    map[r.day] ??= {date:r.day, reviewed:0, added:0}; map[r.day].reviewed++
  }
  return Object.values(map).sort((a,b) => a.date.localeCompare(b.date))
}
async function legacyStats(fromDate: string, toDate: string): Promise<DailyStat[]> {
  if (await usesNativeStorage()) return cloud('stats', { from: fromDate, to: toDate })
  if (IS_TAURI) {
    return invoke<DailyStat[]>('get_daily_stats', { fromDate, toDate })
  }
  const map = lsRead<Record<string, DailyStat>>(LS_KEYS.dailyStats, {})
  return Object.values(map)
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Keyboard bindings are device preferences, including in the desktop WebView.
export function loadShortcuts(): unknown {
  return lsRead<unknown>('vibe-word:shortcuts:v1', null)
}
export function saveShortcuts(value: import('./shortcuts').Shortcuts): void {
  lsWrite('vibe-word:shortcuts:v1', value)
  window.dispatchEvent(new Event('vibe-shortcuts-changed'))
}

// Interface language is a device preference, separate from synced study settings.
export type LanguagePreference = 'system' | 'zh-Hans' | 'en'
export function loadLanguage(): LanguagePreference {
  const value = lsRead<unknown>('vibe-word:language:v1', 'system')
  return value === 'en' || value === 'zh-Hans' ? value : 'system'
}
export function saveLanguage(value: LanguagePreference): void {
  lsWrite('vibe-word:language:v1', value)
}

// Document drafts stay on this Mac, outside the synchronized card event store.
export async function supportsDocumentImport(): Promise<boolean> { return usesNativeStorage() }
type FileImportResult = import('./importTypes').ImportedDocument | { importedCount: number }
export async function chooseImportDocument(): Promise<FileImportResult | null> {
  if (!await usesNativeStorage()) throw new Error('文档导入需要 Mac 应用')
  return cloud('chooseDocument')
}
export async function parseImportDocument(file: File): Promise<FileImportResult> {
  if (!await usesNativeStorage()) throw new Error('文档导入需要 Mac 应用')
  if (!/\.(pdf|docx|txt|text|md|csv|json|jsonl)$/i.test(file.name)) throw new Error('支持 PDF、DOCX、TXT、TEXT、Markdown、CSV、JSON 和 JSONL；旧版 .doc 请另存为 .docx')
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('文档为空或超过 20 MB，请拆分后导入')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return cloud('parseDocument', { name: file.name, data: btoa(binary) })
}
export async function loadImportJobs(): Promise<import('./importTypes').ImportJob[]> {
  if (!await usesNativeStorage()) return []
  const jobs = await cloud<import('./importTypes').ImportJob[]>('importJobs')
  if (!Array.isArray(jobs) || jobs.some(job => job.version !== 1 || !Array.isArray(job.drafts) || !Array.isArray(job.chunks) || !job.document)) {
    throw new Error('导入任务文件格式无效，请备份后检查')
  }
  return jobs
}
export async function saveImportJobs(jobs: import('./importTypes').ImportJob[]): Promise<void> {
  if (!await usesNativeStorage()) throw new Error('文档导入需要 Mac 应用')
  await cloud('saveImportJobs', { jobs })
}
export async function saveAcceptedImportCards(cards: Card[]): Promise<void> {
  if (!await usesNativeStorage()) throw new Error('文档导入需要 Mac 应用')
  await cloud('acceptImportCards', { cards })
  window.dispatchEvent(new Event('vibe-library-changed'))
}

export async function loadImportImage(id: string): Promise<string> { return cloud('importImage', { id }) }

// The settings page commits the whole draft; native model/study events share one batch.
export async function savePreferences(value: {
  limit: number; studyScope: import('../types').StudyScope; llm: LLMConfig; image: ImageGenConfig; cloud: boolean | null; language: LanguagePreference
}): Promise<void> {
  if (await usesNativeStorage()) {
    await cloud('savePreferences', { limit: value.limit, studyScope: value.studyScope, llm: value.llm, image: value.image, enabled: value.cloud })
  } else {
    await saveSettings({ newCardsPerDay: value.limit, studyScope: value.studyScope })
    await saveLLMConfig(value.llm)
    await saveImageGenConfig(value.image)
  }
}

export interface BackupInfo {name:string; cards:number; reviews:number}
const BACKUP_KEY = 'vibe-word:backups:v1'
const RESTORE_KEY = 'vibe-word:restore-pending:v1'
interface BrowserBackup extends BackupInfo { values: Record<string,string> }
function browserSnapshot(name:string): BrowserBackup {
  const values: Record<string,string> = {}
  for (let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i)!
    if(key.startsWith('vibe-word:') && key!==BACKUP_KEY && key!==RESTORE_KEY) values[key]=localStorage.getItem(key)!
  }
  const cards = JSON.parse(values[LS_KEYS.cards] ?? '[]') as Card[]
  const study = JSON.parse(values[STUDY_KEY] ?? '{"reviews":[]}') as StudyData
  return {name,cards:cards.length,reviews:study.reviews.filter(r=>!r.undone).length,values}
}
export async function listBackups(): Promise<BackupInfo[]> {
  if(await usesNativeStorage()) return cloud('backups')
  return lsRead<BrowserBackup[]>(BACKUP_KEY,[]).map(({name,cards,reviews})=>({name,cards,reviews}))
}
export async function createBackup(): Promise<void> {
  if(await usesNativeStorage()) {await cloud('createBackup'); return}
  if(IS_TAURI) throw new Error('此平台暂不支持完整备份')
  const backups=lsRead<BrowserBackup[]>(BACKUP_KEY,[])
  lsWrite(BACKUP_KEY,[browserSnapshot(`manual-${new Date().toISOString()}`),...backups])
}
function autoBackup():void {
  if(IS_TAURI) return
  const backups=lsRead<BrowserBackup[]>(BACKUP_KEY,[]), name=`auto-${todayKey()}`
  if(backups.some(b=>b.name===name)) return
  const next=[browserSnapshot(name),...backups]
  let count=0
  lsWrite(BACKUP_KEY,next.filter(b=>!b.name.startsWith('auto-') || ++count<=14))
}
export async function restoreBackup(name:string):Promise<void> {
  if(await usesNativeStorage()) {await cloud('restoreBackup',{name}); window.dispatchEvent(new Event('vibe-library-restored'));return}
  if(IS_TAURI) throw new Error('此平台暂不支持完整备份')
  const backup=lsRead<BrowserBackup[]>(BACKUP_KEY,[]).find(b=>b.name===name)
  if(!backup) throw new Error('找不到备份')
  await createBackup()
  const before=browserSnapshot('rollback')
  function replace(values:Record<string,string>) {
    const keys=Object.keys(browserSnapshot('current').values)
    for(const key of keys) localStorage.removeItem(key)
    for(const [key,value] of Object.entries(values)) localStorage.setItem(key,value)
  }
  localStorage.setItem(RESTORE_KEY, name)
  try {replace(backup.values);localStorage.removeItem(RESTORE_KEY)} catch(err) {replace(before.values);localStorage.removeItem(RESTORE_KEY);throw err}
  if(typeof window !== 'undefined') window.dispatchEvent(new Event('vibe-library-restored'))
}

// Finish a restore interrupted between browser key writes before reading the library.
if (!IS_TAURI && typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
  const pending = localStorage.getItem(RESTORE_KEY)
  if (pending) {
    const backup = lsRead<BrowserBackup[]>(BACKUP_KEY, []).find(b=>b.name===pending)
    if (!backup) throw new Error('找不到恢复中的备份')
    for(const key of Object.keys(browserSnapshot('recover').values)) localStorage.removeItem(key)
    for(const [key,value] of Object.entries(backup.values)) localStorage.setItem(key,value)
    localStorage.removeItem(RESTORE_KEY)
  }
}

// Appearance is a device preference shared by every screen.
export type ThemePreference = 'light' | 'dark' | 'system'
export function loadTheme(): ThemePreference {
  const value = lsRead<unknown>('vibe-word:theme:v1', 'light')
  return value === 'dark' || value === 'system' ? value : 'light'
}
export function saveTheme(value: ThemePreference): void {
  lsWrite('vibe-word:theme:v1', value)
}

export async function loadDecks(): Promise<Deck[]> {
  if (await usesNativeStorage()) return cloud('decks')
  const raw = IS_TAURI ? await invoke<string | null>('get_setting', { key: 'vibe-word:decks:v1' }) : localStorage.getItem('vibe-word:decks:v1')
  return raw ? JSON.parse(raw) : [{ id: 'default', name: '默认牌组' }]
}
async function writeDecks(decks: Deck[]): Promise<void> {
  if (IS_TAURI) await invoke('set_setting', { key: 'vibe-word:decks:v1', value: JSON.stringify(decks) })
  else lsWrite('vibe-word:decks:v1', decks)
}
export async function saveDeck(deck: Deck): Promise<void> {
  const decks = await loadDecks()
  if (!deck.name.trim() || deck.name.includes('::') || deck.parentId === deck.id || (deck.id === 'default' && deck.parentId) ||
      (deck.parentId && (!decks.some(d => d.id === deck.parentId) || ancestors(deck.parentId, decks).includes(deck.id))) ||
      (deck.newCardsPerDay !== undefined && (!Number.isInteger(deck.newCardsPerDay) || deck.newCardsPerDay < 0 || deck.newCardsPerDay > 100000))) throw new Error('牌组名称、父级或每日上限无效')
  if (await usesNativeStorage()) await cloud('saveDeck', { deck })
  else await writeDecks([...decks.filter(d => d.id !== deck.id), deck])
  window.dispatchEvent(new Event('vibe-library-changed'))
}
export async function moveCards(ids: string[], deckId: string): Promise<void> {
  if (!(await loadDecks()).some(d => d.id === deckId)) throw new Error('牌组不存在')
  if (await usesNativeStorage()) await cloud('moveCards', { ids, deckId })
  else for (const card of await loadCustomCards()) if (ids.includes(card.id)) await saveOneCard({ ...card, deckId })
  window.dispatchEvent(new Event('vibe-library-changed'))
}
export async function deleteDeck(id: string): Promise<void> {
  if (id === 'default') throw new Error('不能删除默认牌组')
  if (await usesNativeStorage()) await cloud('deleteDeck', { id })
  else {
    const decks = await loadDecks(), parentId = decks.find(d => d.id === id)?.parentId
    await moveCards((await loadCustomCards()).filter(c => c.deckId === id).map(c => c.id), 'default')
    await writeDecks(decks.filter(d => d.id !== id).map(d => d.parentId === id ? { ...d, parentId } : d))
  }
  window.dispatchEvent(new Event('vibe-library-changed'))
}
export interface AnkiPreview { stage: string; name: string; count: number; decks: Deck[]; warnings: string[]; mediaCount: number }
export async function inspectAnki(): Promise<AnkiPreview | null> { return invoke('inspect_anki') }
export async function ankiPage(stage: string, offset: number): Promise<Card[]> { return cloud('ankiPage', { stage, offset }) }
export async function discardAnki(stage: string): Promise<void> { return cloud('discardAnki', { stage }) }
export async function commitAnki(stage: string, offset: number, deckIds: string[], parentId?: string): Promise<{ added: number; skipped: number; next: number; total: number; done: boolean }> {
  const result = await cloud<{ added: number; skipped: number; next: number; total: number; done: boolean }>('commitAnki', { stage, offset, deckIds, parentId })
  window.dispatchEvent(new Event('vibe-library-changed')); return result
}
export async function loadMedia(id: string, stage?: string): Promise<string> { return cloud(stage ? 'ankiMedia' : 'media', { id, stage }) }
export async function editAnkiNote(id: string, fields: Record<string, string>): Promise<void> { await cloud('editAnkiNote', { id, fields }); window.dispatchEvent(new Event('vibe-library-changed')) }

export async function pendingAnki(): Promise<AnkiPreview[]> { return await usesNativeStorage() ? cloud('pendingAnki') : [] }
export interface AnkiModel { id: string; name: string; cloze: boolean; fields: string[] }
export async function ankiModels(stage: string): Promise<AnkiModel[]> { return cloud('ankiModels', { stage }) }
export async function remapAnki(stage: string, mappings: Record<string, {front: string; back: string}>): Promise<AnkiPreview> { return cloud('prepareAnki', { stage, mappings }) }

export async function cancelAnki(): Promise<void> { await invoke('cancel_anki') }

// Compare and replace in the storage transaction; never seed progress or count a new card.
export async function replaceRegeneratedCard(expected: Card, draft: { front: string; back: string; example: string }): Promise<void> {
  if (expected.anki) throw new Error('Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记')
  if (!draft.front.trim() || !draft.back.trim()) throw new Error('卡片正反面不能为空')
  if (await usesNativeStorage()) await cloud('replaceRegeneratedCard', { expected, draft })
  else if (IS_TAURI) await invoke('replace_regenerated_card', { expected, draft })
  else {
    // Keep the read/check/write synchronous within this browser task.
    const cards = lsRead<Card[]>(LS_KEYS.cards, [])
    const index = cards.findIndex(card => card.id === expected.id)
    if (index < 0) throw new Error('卡片已删除，请关闭后重新检查')
    const current = cards[index]
    if (current.anki || current.front !== expected.front || current.back !== expected.back || (current.example ?? '') !== (expected.example ?? '')) throw new Error('卡片内容已更新，请关闭后重新生成')
    cards[index] = { ...current, front: draft.front, back: draft.back, example: draft.example || undefined }
    lsWrite(LS_KEYS.cards, cards)
  }
  window.dispatchEvent(new Event('vibe-library-changed'))
}

// Window layout preferences stay local to this device.
export function loadSidebarWidth(): number | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('vibe-word:sidebar-width:v1') ?? 'null')
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(160, Math.min(360, value)) : null
  } catch { return null }
}
export function saveSidebarWidth(value: number): void {
  try { localStorage.setItem('vibe-word:sidebar-width:v1', JSON.stringify(value)) } catch { /* Layout still works without persistence. */ }
}

export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  if(await usesNativeStorage()) return validateConfig(await cloud<SchedulerConfig>('schedulerConfig'))
  return validateConfig((await storedStudy()).schedulerConfig ?? structuredClone(DEFAULT_SCHEDULER))
}
export async function saveSchedulerConfig(config:SchedulerConfig, expectedId:string):Promise<void> {
  validateConfig(config)
  await studyTransaction(async()=>{
    if(await usesNativeStorage()) { await cloud('saveSchedulerConfig',{config,expectedId}); return }
    const data=await loadStudyData()
    if((data.schedulerConfig??DEFAULT_SCHEDULER).id!==expectedId) throw new Error('学习状态已变化，请重新检查')
    data.schedulerConfig=config
    await writeStudyData(data)
  })
  window.dispatchEvent(new Event('vibe-library-changed'))
}
export async function rescheduleAll(configId:string):Promise<number> {
  return studyTransaction(async()=>{
    if(await usesNativeStorage()) return cloud<number>('rescheduleAll',{configId})
    const data=await loadStudyData(),config=data.schedulerConfig??DEFAULT_SCHEDULER
    if(config.id!==configId) throw new Error('学习状态已变化，请重新检查')
    await backupBeforeFSRS(data)
    const states=rescheduleProjection(Object.values(data.progress).filter(s=>!data.controls[s.cardId]?.suspended),data.reviews,config)
    data.rescheduledAt ??= {}
    for(const state of states) { data.progress[state.cardId]=state;data.rescheduledAt[state.cardId]=Date.now() }
    await writeStudyData(data)
    window.dispatchEvent(new Event('vibe-library-changed'))
    return states.length
  })
}

async function backupBeforeFSRS(data:StudyData):Promise<void> {
  if(IS_TAURI && !await usesNativeStorage()) {
    // Legacy SQLite desktop storage has no full-library backup API. Preserve an
    // independent complete scheduling checkpoint before touching its study overlay.
    const key='vibe-word:fsrs-checkpoints:v1'
    const saved=await invoke<string|null>('get_setting',{key})
    const checkpoints=saved?JSON.parse(saved) as unknown[]:[]
    checkpoints.push({createdAt:Date.now(),study:data,legacyProgress:await rawProgress()})
    await invoke('set_setting',{key,value:JSON.stringify(checkpoints)})
  } else await createBackup()
}

/** Save content and metadata together; editing never seeds or resets progress. */
export async function saveEditedCard(expected: Card, draft: Card, fields?: Record<string, string>): Promise<void> {
  if (await usesNativeStorage()) {
    await cloud('saveEditedCard', { expected, draft, ...(fields ? { fields } : {}) })
  } else {
    if (expected.anki) throw new Error('Anki 笔记编辑需要桌面应用')
    const comparable = (card: Card) => JSON.stringify([card.front, card.back, card.example ?? '', normalizeTags(card.tags), card.deckId ?? 'default', card.anki ?? null])
    const edit = (cards: Card[]) => {
      const index = cards.findIndex(c => c.id === expected.id)
      if (index < 0) throw new Error('卡片已删除，请刷新')
      if (comparable(cards[index]) !== comparable(expected)) throw new Error('卡片内容已更新，请关闭后重新编辑')
      if (!draft.front.trim()) throw new Error('卡片正面不能为空')
      cards[index] = { ...cards[index], front: draft.front.trim(), back: draft.back.trim(), example: draft.example?.trim() || undefined, tags: normalizeTags(draft.tags), deckId: draft.deckId ?? 'default' }
      return cards[index]
    }
    const decks = await loadDecks()
    if (!decks.some(d => d.id === (draft.deckId ?? 'default'))) throw new Error('牌组不存在')
    if (IS_TAURI) await saveOneCard(edit(await loadCustomCards()))
    else { const cards = lsRead<Card[]>(LS_KEYS.cards, []); edit(cards); lsWrite(LS_KEYS.cards, cards) }
  }
  window.dispatchEvent(new Event('vibe-library-changed'))
}

export async function previewAnkiEdit(id: string, fields: Record<string, string>): Promise<{ cards: Card[]; added: number; removed: number }> {
  if (!await usesNativeStorage()) throw new Error('Anki 笔记编辑需要桌面应用')
  return cloud('previewAnkiEdit', { id, fields })
}

// AI drafts are device-local, separate from the synchronized formal library.
let aiDatabase: Promise<IDBDatabase> | undefined
function openAIDatabase(): Promise<IDBDatabase> {
  return aiDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('vibe-word-ai', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { aiDatabase = undefined; reject(request.error) }
  })
}
async function browserAIState(value?: import('./aiTaskTypes').AITaskState): Promise<import('./aiTaskTypes').AITaskState | undefined> {
  const db = await openAIDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', value ? 'readwrite' : 'readonly')
    const request = value ? tx.objectStore('state').put(value, 'queue') : tx.objectStore('state').get('queue')
    tx.oncomplete = () => resolve(value ?? request.result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本地保存失败'))
  })
}
export async function loadAITasks(): Promise<import('./aiTaskTypes').AITaskState> {
  const empty = { version: 1 as const, tasks: [] }
  const value = await usesNativeStorage() ? await cloud<import('./aiTaskTypes').AITaskState | null>('aiTasks') : IS_TAURI
    ? JSON.parse(await invoke<string>('get_setting', { key: 'ai-tasks-v1' }) || 'null') : await browserAIState()
  if (!value) return empty
  if (value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.some((task: import('./aiTaskTypes').GenerationTask) => !task.id || !Array.isArray(task.drafts))) throw new Error('任务队列格式无效，请备份后检查')
  return value
}
export async function saveAITasks(state: import('./aiTaskTypes').AITaskState): Promise<void> {
  if (await usesNativeStorage()) await cloud('saveAITasks', { state })
  else if (IS_TAURI) await invoke('set_setting', { key: 'ai-tasks-v1', value: JSON.stringify(state) })
  else await browserAIState(state)
}

const AI_JOURNAL = 'vibe-word:ai-commit-pending:v1'
const AI_RECEIPTS = 'vibe-word:ai-receipts:v1'
// Roll forward before any browser storage read/write. A quota failure never
// exposes a partially committed library to another operation in this process.
function recoverAICommit(): void {
  const raw = localStorage.getItem(AI_JOURNAL)
  if (!raw) return
  const entries: [string, string][] = JSON.parse(raw)
  for (const [key, value] of entries) localStorage.setItem(key, value)
  localStorage.removeItem(AI_JOURNAL)
}
export async function confirmAIDraft(draftId: string, card: Card, expected?: Card): Promise<void> {
  await studyTransaction(async () => {
    if (!card.front.trim() || !card.back.trim() || card.anki) throw new Error('卡片正反面不能为空')
    if (await usesNativeStorage()) { await cloud('confirmAIDraft', { draftId, card, expected }); return }
    if (IS_TAURI) {
      await invoke('confirm_ai_draft', { draftId, card: cardToRow(card), expected: expected ? cardToRow(expected) : null, day: todayKey() }); return
    }
    const browserStudy = expected ? undefined : await loadStudyData()
    recoverAICommit()
    const receipts = lsRead<string[]>(AI_RECEIPTS, [])
    if (receipts.includes(draftId)) return
    const cards = lsRead<Card[]>(LS_KEYS.cards, [])
    const entries: [string, string][] = []
    if (expected) {
      const index = cards.findIndex(c => c.id === expected.id)
      if (index < 0) throw new Error('卡片已删除，请关闭后重新检查')
      const current = cards[index]
      if (current.anki || ['front', 'back', 'example', 'deckId'].some(key => (current[key as keyof Card] ?? '') !== (expected[key as keyof Card] ?? '')) || JSON.stringify(normalizeTags(current.tags)) !== JSON.stringify(normalizeTags(expected.tags))) throw new Error('卡片内容已更新，请关闭后重新生成')
      cards[index] = { ...current, front: card.front, back: card.back, example: card.example, tags: card.tags, deckId: card.deckId }
    } else {
      if (cards.some(c => c.id === card.id)) throw new Error('卡片 ID 已存在')
      cards.push(card)
      const data = browserStudy!
      data.progress[card.id] = initialState(card.id)
      entries.push([STUDY_KEY, JSON.stringify(data)])
      const progress = lsRead<ProgressMap>(LS_KEYS.progress, {})
      progress[card.id] = data.progress[card.id]
      entries.push([LS_KEYS.progress, JSON.stringify(progress)])
      const stats = lsRead<Record<string, { added: number; reviewed: number }>>(LS_KEYS.dailyStats, {})
      const day = todayKey(); stats[day] ??= { added: 0, reviewed: 0 }; stats[day].added++
      entries.push([LS_KEYS.dailyStats, JSON.stringify(stats)])
    }
    entries.push([LS_KEYS.cards, JSON.stringify(cards)], [AI_RECEIPTS, JSON.stringify([...receipts, draftId])])
    localStorage.setItem(AI_JOURNAL, JSON.stringify(entries))
    recoverAICommit()
  })
  window.dispatchEvent(new Event('vibe-library-changed'))
}
