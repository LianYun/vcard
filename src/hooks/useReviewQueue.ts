import { flushSync } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, CardControl, StudyScope, ReviewButton, StudyData } from '../types'
import { GRADE_BY_BUTTON, initialState } from '../lib/sm2'
import { DEFAULT_SCHEDULER, fsrsPreview } from '../lib/fsrs'
import { loadDecks, issueNewCards, recordReview, loadStudyData, loadSettings, loadMeta, setCardControl, undoReview, startNativeStudy } from '../lib/storage'
import { createLogger } from '../lib/log'
import { inDeck } from '../lib/decks'
import { allCards } from '../lib/cardStore'
import { matchesStudyScope } from '../lib/tags'
import { aheadCards, available, selectStudyCards, shuffleStudyCards } from '../lib/study'

const empty: StudyData = {controls:{}, reviews:[], progress:{}, issued:{}}
const log = createLogger('study-start')
export function useReviewQueue(scope: StudyScope = null, ahead = 0, deckId: string | null = null) {
  const [data, setData] = useState<StudyData>(empty)
  const [queue, setQueue] = useState<Card[]>([])
  const [total, setTotal] = useState(0), [done, setDone] = useState(0), [relearned, setRelearned] = useState(0)
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null)
  const [emptyReason, setEmptyReason] = useState('当前范围暂无待学卡片')
  const [now, setNow] = useState(Date.now())
  const [last, setLast] = useState<{id:string; card:Card; queue:Card[]; done:number; relearned:number} | null>(null)
  const busy = useRef(false)
  const queueRef = useRef(queue); queueRef.current = queue
  const refreshVersion = useRef(0)
  const pendingRefresh = useRef(false)
  const refresh = useCallback(async () => {
    try {
      const version = ++refreshVersion.current
      const [next, cards, decks] = await Promise.all([loadStudyData({ cardIds: queueRef.current.map(c => c.id), includeReviews: false }), allCards(), loadDecks()])
      if (version !== refreshVersion.current) return next
      const cardsById = new Map(cards.map(card => [card.id, card]))
      setData(next)
      setQueue(previous => previous.flatMap(card => {
        const updated = cardsById.get(card.id)
        return updated && inDeck(updated, deckId, decks) && matchesStudyScope(updated, scope) && available(next.controls[card.id]) ? [updated] : []
      }))
      setError(null)
      return next
    } catch (error) { setError(String(error)); throw error }
  }, [deckId, scope])
  const build = useCallback(async () => {
    if (busy.current) return
    busy.current = true; setReady(false); setError(null); setEmptyReason('当前范围暂无待学卡片')
    try {
      const started = performance.now()
      const native = await startNativeStudy(scope, ahead, deckId)
      if (native) {
        const received = performance.now()
        const selected = shuffleStudyCards(native.cards)
        setEmptyReason(native.emptyReason)
        setData(native.data); queueRef.current = selected; setQueue(selected); setTotal(selected.length)
        setDone(0); setRelearned(0); setLast(null); setReady(true); setNow(Date.now())
        log.info('ready', { mode: 'native', cards: selected.length, ...native.timings,
          requestMs: received - started, shuffleAndPublishMs: performance.now() - received, totalMs: performance.now() - started })
        return
      }
      const readStart = performance.now()
      const [all, state, settings, meta, decks] = await Promise.all([allCards(), loadStudyData({ includeReviews: false }), loadSettings(), loadMeta(), loadDecks()])
      const readEnd = performance.now()
      const cards = all.filter(c => inDeck(c, deckId, decks) && matchesStudyScope(c,scope) && available(state.controls[c.id]))
      let selected: Card[]
      if (ahead) selected = aheadCards(cards,state.progress,state.controls,ahead)
      else {
        const selection = selectStudyCards(all.filter(c => inDeck(c, deckId, decks)), state, settings, meta, scope, decks)
        if (!selection.matching.length) setEmptyReason('没有匹配卡片，请选择其他标签')
        else if (!selection.reviews.length && selection.freshCount > 0 && selection.budget === 0) setEmptyReason('今日新卡额度已用完')
        const issued = new Set(await issueNewCards(selection.fresh.map(c => c.id)))
        selected = [...selection.reviews, ...selection.fresh.filter(c => issued.has(c.id))]
      }
      selected = shuffleStudyCards(selected)
      setData(await loadStudyData({ cardIds: selected.map(c => c.id), includeReviews: false })); queueRef.current = selected; setQueue(selected); setTotal(selected.length)
      setDone(0); setRelearned(0); setLast(null); setReady(true); setNow(Date.now())
      log.info('ready', { mode: 'local', cards: selected.length, readMs: readEnd - readStart, selectIssueAndReloadMs: performance.now() - readEnd, totalMs: performance.now() - started })
    } catch(err) { setError(String(err)); setReady(true) }
    finally { busy.current = false }
  }, [scope,ahead,deckId])
  useEffect(()=>{ void build() },[build])
  useEffect(()=>{
    const tick = setInterval(()=>setNow(Date.now()),1000)
    const change = () => { if (busy.current) pendingRefresh.current = true; else void refresh().catch(err=>setError(String(err))) }
    window.addEventListener('vibe-library-changed',change); window.addEventListener('focus',change)
    return ()=>{clearInterval(tick); window.removeEventListener('vibe-library-changed',change); window.removeEventListener('focus',change)}
  },[refresh])
  const current = queue.find(c => data.progress[c.id]?.learningDue == null || data.progress[c.id].learningDue! <= now) ?? null
  async function action(operation:()=>Promise<void>) {
    if(busy.current) return
    busy.current = true; refreshVersion.current++; setSaving(true); setError(null)
    try {await operation(); pendingRefresh.current = false; await refresh(); setNow(Date.now())}
    catch(err) {setError(String(err))}
    finally {
      busy.current=false; setSaving(false)
      if (pendingRefresh.current) { pendingRefresh.current = false; void refresh().catch(err=>setError(String(err))) }
    }
  }
  async function review(button:ReviewButton): Promise<boolean> {
    if (!current || busy.current) return false
    busy.current = true; refreshVersion.current++; setSaving(true); setError(null)
    try {
      const { reviewId, controlUpdates = {}, record: _record, revision: _revision, ...state } = await recordReview(data.progress[current.id] ?? initialState(current.id), GRADE_BY_BUTTON[button], { now, configId:(data.schedulerConfig??DEFAULT_SCHEDULER).id, before:data.progress[current.id]??initialState(current.id) })
      // Commit only the small session delta as soon as the native write is durable.
      flushSync(() => {
        setLast({id:reviewId,card:current,queue:[...queue],done,relearned})
        setData(previous => ({...previous, progress:{...previous.progress,[current.id]:state}, controls:{...previous.controls,...controlUpdates}}))
        setQueue(previous => previous.filter(card => (card.id !== current.id || state.learningDue != null) && available(controlUpdates[card.id] ?? data.controls[card.id])))
        if(state.learningDue == null) setDone(n=>n+1)
        if(button==='again') setRelearned(n=>n+1)
        setNow(Date.now())
        setSaving(false)
      })
      if (!_record) await refresh()
      return true
    } catch(err) { setError(String(err)); return false }
    finally {
      busy.current = false; setSaving(false)
      if (pendingRefresh.current) { pendingRefresh.current = false; void refresh().catch(err=>setError(String(err))) }
    }
  }
  async function control(patch:CardControl) {
    if(current) await action(()=>setCardControl(current.id,patch))
  }
  async function undo() {
    if(!last) return
    await action(async()=>{
      await undoReview(last.id)
      queueRef.current = last.queue
      setQueue(last.queue)
      setDone(last.done); setRelearned(last.relearned); setLast(null)
    })
  }
  const waitingUntil = Math.min(...queue.map(c=>data.progress[c.id]?.learningDue ?? Infinity))
  return {emptyReason,current,total,remaining:queue.length,done,ready,finished:ready&&queue.length===0,relearned,error,saving,
    previews:current?fsrsPreview(data.progress[current.id]??initialState(current.id),data.schedulerConfig??DEFAULT_SCHEDULER,now):null, data,review,reset:build,control,undo,canUndo:!!last,refresh,waitingUntil,now}
}
