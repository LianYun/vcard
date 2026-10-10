import { DEFAULT_SCHEDULER, retrievability } from '../lib/fsrs'
import { scopeLabel } from './TagSelector'
import { useShortcuts } from '../hooks/useShortcuts'
import { shortcutAction } from '../lib/shortcuts'
import { localizedMessage, t } from '../lib/i18n'
// The main study page. Drives a review session via useReviewQueue.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReviewQueue } from '../hooks/useReviewQueue'
import { RegenerateCardDialog } from './RegenerateCardDialog'
import type { Card } from '../types'
import { CardView } from './CardView'
import { ReviewButtons } from './ReviewButtons'
import { useCardEditor } from './CardEditor'
import { addDays, todayKey } from '../lib/date'
import { GRADE_BY_BUTTON, intervalLabel } from '../lib/sm2'
import { loadReviewHistory } from '../lib/storage'
import type { ReviewRecord, ReviewButton, StudyScope } from '../types'

export function StudyPage({ onExit, active = true, onSessionChange, scope = null, ahead = 0, deckId = null, exitLabel = '返回我的卡片' }: { deckId?: string | null; ahead?: number; scope?: StudyScope; exitLabel?: string; onExit: () => void; active?: boolean; onSessionChange?: (pending: boolean) => void }) {
  const openEditor = useCardEditor()
  const shortcuts = useShortcuts()
  const menu = useRef<HTMLDivElement>(null)
  const queue = useReviewQueue(scope,ahead,deckId)
  const wasActive = useRef(active)
  useEffect(() => {
    onSessionChange?.(queue.ready && queue.remaining > 0)
  }, [queue.ready, queue.remaining, onSessionChange])
  useEffect(() => {
    if (active && !wasActive.current && queue.finished) queue.reset()
    wasActive.current = active
  }, [active, queue.finished, queue.reset])
  const [tools,setTools]=useState(false)
  useEffect(() => {
    if (!tools) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setTools(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setTools(false); menu.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [tools])
  useEffect(() => { if (!active) setTools(false) }, [active])
  const [details,setDetails]=useState(false)
  const [history,setHistory]=useState<ReviewRecord[]>([])
  const [historyLoading,setHistoryLoading]=useState(false)
  const [historyError,setHistoryError]=useState('')
  const historyCardId = queue.current?.id
  useEffect(()=>{
    if (!details || !historyCardId) return
    let live = true
    setHistoryLoading(true); setHistoryError(''); setHistory([])
    void loadReviewHistory(historyCardId).then(records=>{if(live)setHistory(records)}).catch(error=>{if(live)setHistoryError(String(error))}).finally(()=>{if(live)setHistoryLoading(false)})
    return()=>{live=false}
  },[details,historyCardId])
  const [regenerating, setRegenerating] = useState<Card | null>(null)
  const [regenerated, setRegenerated] = useState(false)
  useEffect(() => { if (!regenerated) return; const timer = setTimeout(() => setRegenerated(false), 3500); return () => clearTimeout(timer) }, [regenerated])
  useEffect(() => { if (!active) setRegenerating(null) }, [active])
  useEffect(()=>{
    if(!details) return
    const previous=document.activeElement as HTMLElement|null
    const modal=document.querySelector<HTMLElement>('.study-modal')
    const focusable=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,select,[tabindex="0"]')??[])
    focusable()[0]?.focus()
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setDetails(false)}
      if(event.key==='Tab'){const items=focusable(),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }
    document.addEventListener('keydown',key)
    return()=>{document.removeEventListener('keydown',key);previous?.focus()}
  },[details])
  const currentId = queue.current?.id
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null)
  const flipped = currentId != null && flippedCardId === currentId
  const scroll = useRef<HTMLDivElement>(null)
  const flip = useCallback(() => {
    setFlippedCardId(previous => previous === currentId ? null : currentId ?? null)
    scroll.current?.scrollTo({ top: 0 })
  }, [currentId])
  async function review(button: ReviewButton) {
    if (queue.saving) return
    if (await queue.review(button)) {
      setFlippedCardId(null)
      scroll.current?.scrollTo({ top: 0 })
    }
  }
  // A new card is front-facing in its first render, before any paint.
  useLayoutEffect(() => {
    setFlippedCardId(null)
    scroll.current?.scrollTo({ top: 0 })
  }, [currentId])

  useEffect(() => {
    if (regenerating || details || tools || !active || !queue.ready || queue.saving) return
    function onKeyDown(event: KeyboardEvent) {
      const action = shortcutAction(event, shortcuts)
      if (!action) return
      if (action === 'undo' && queue.canUndo) { event.preventDefault(); void queue.undo(); return }
      if (!queue.current || queue.finished) return
      if (action === 'flip') { event.preventDefault(); flip() }
      else if (action === 'mark') { event.preventDefault(); void queue.control({ marked: !queue.data.controls[queue.current.id]?.marked }) }
      else if (action === 'again' || action === 'hard' || action === 'good' || action === 'easy') { event.preventDefault(); void review(action) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queue, active, regenerating, details, tools, shortcuts])

  return (
    <section className="study-shell">
      <header className="study-header">
        <button className="study-quiet" onClick={onExit} disabled={queue.saving}>{`‹ ${t('返回')}`}</button>
        <div className="study-progress">
          {queue.ready && <>
            <progress aria-label={t("学习进度")} value={queue.done} max={Math.max(1, queue.total)} />
            <span>{queue.done} / {queue.total}</span>
          </>}
        </div>
        <div className="study-more" ref={menu} hidden={!queue.ready}>
          <button className="study-quiet" onClick={() => setTools(!tools)} aria-expanded={tools} aria-controls="study-actions" aria-label={t('更多操作')} title={t('更多操作')}>···</button>
          {tools && <div id="study-actions" className="study-tool-menu" role="group" aria-label={t('更多操作')} onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) setTools(false) }}>
            <button disabled={queue.saving || !queue.canUndo} onClick={() => void queue.undo()}>{t('撤销评分')}</button>
            {queue.current && <>
              <button disabled={queue.saving} onClick={() => void queue.control({buriedUntil:addDays(todayKey(),1)})}>{t('今天跳过')}</button>
              <button disabled={queue.saving} onClick={() => void queue.control({suspended:true})}>{t('暂停这张卡')}</button>
              <button disabled={queue.saving} onClick={() => void queue.control({marked:!queue.data.controls[queue.current!.id]?.marked})}>{queue.data.controls[queue.current.id]?.marked ? t('取消标记') : t('标记卡片')}</button>
              <button disabled={queue.saving} onClick={() => openEditor({ kind: 'card', id: queue.current!.id })}>{t('编辑内容')}</button>
              <button disabled={queue.saving || !!queue.current.anki} title={queue.current.anki ? t('Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记') : undefined} onClick={() => {setRegenerated(false);setRegenerating(structuredClone(queue.current!))}}>{t('重新生成')}</button>
              {queue.current.anki && <p className="regenerate-note">{t('Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记')}</p>}
              <button onClick={() => setDetails(true)}>{t('学习详情')}</button>
            </>}
          </div>}
        </div>
      </header>
      <div className={`study-scroll${!queue.ready ? ' is-preparing' : ''}`} ref={scroll}>
        <div className="study-content">
          <p className="section-copy study-scope-label">{t("学习范围：{0}", scopeLabel(scope))}</p>
          {queue.error && queue.current && <div role="alert" className="study-error"><p>{localizedMessage(queue.error)}</p><button className="study-quiet" onClick={()=>void queue.refresh().catch(()=>{})}>{t('重新检查')}</button></div>}
          {!queue.ready ? <div className="study-loading" role="status" aria-live="polite" aria-busy="true">
            <div className="study-loading-art" aria-hidden="true">
              <span className="study-loading-ring" />
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <rect x="5" y="4" width="22" height="26" rx="5" transform="rotate(-10 5 4)" fill="currentColor" opacity=".15" />
                <rect x="9" y="7" width="22" height="26" rx="5" fill="var(--study-card)" stroke="currentColor" strokeWidth="1.8" />
                <path d="M15 16h10M15 21h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <h2>{t("准备中…")}</h2>
            <p>{t("正在整理本次学习的卡片")}</p>
          </div> : queue.error && !queue.current ? (
            <div className="study-message" role="alert">
              <p>{localizedMessage(queue.error)}</p><button className="btn-secondary" onClick={queue.reset}>{t("重新检查")}</button>
            </div>
          ) : queue.finished ? (
            <div className="study-message">
              <h2 className="text-xl font-semibold">{t(queue.done ? "当前范围暂无待学卡片" : queue.emptyReason)}</h2>
              <p>{queue.done ? t("共完成 {0} 张，其中重学 {1} 次。明天见。", queue.done, queue.relearned) : t("可以返回调整范围，或稍后重新检查。")}</p>
              <button className="btn-primary" onClick={onExit}>{t(exitLabel)}</button>
              <button className="study-quiet" onClick={queue.reset}>{t("重新检查")}</button>
            </div>
          ) : !queue.current ? <div className="study-message">
            <h2>{t('稍作停顿，让记忆沉淀')}</h2>
            <p role="status">{t('还有 {0} 张等待重学，{1} 秒后继续。',queue.remaining,Math.max(0,Math.ceil((queue.waitingUntil-queue.now)/1000)))}</p>
            <button className="study-quiet" onClick={onExit}>{t('稍后继续')}</button>
          </div> : queue.current && (
            <>
              <CardView card={queue.current} flipped={flipped} disabled={queue.saving} onFlipChange={() => { if (!queue.saving) flip() }} />
            </>
          )}
        </div>
      </div>
      {queue.ready && queue.current && !queue.error && (
        <footer className="study-dock">
          <div className="study-content">
            <ReviewButtons shortcuts={shortcuts} previews={Object.fromEntries((['again','hard','good','easy'] as ReviewButton[]).map(button=>[button,localizedMessage(intervalLabel(queue.previews![GRADE_BY_BUTTON[button]],queue.now))]))} onReview={(button) => { void review(button) }} disabled={queue.saving} />
            <span className="sr-only" role="status">{queue.saving ? t("正在保存…") : ''}</span>
          </div>
        </footer>
      )}
      {regenerated && <p className="regenerate-toast" role="status">{t('卡片已替换，学习进度已保留')}</p>}
      {regenerating && <RegenerateCardDialog card={regenerating} onClose={() => setRegenerating(null)} onSaved={() => {setRegenerating(null);setFlippedCardId(null);setRegenerated(true);void queue.refresh().catch(() => {})}}/>}
      {details&&queue.current&&<div className="study-modal-backdrop"><section className="study-modal" role="dialog" aria-modal="true" aria-label={t('学习详情')}>
        <h2>{t('学习详情')}</h2><p>{queue.current.front}</p>
        {queue.data.progress[queue.current.id]?.fsrs&&<div className="fsrs-memory"><span>FSRS-6</span><span>{t('稳定性 {0} 天',queue.data.progress[queue.current.id].fsrs!.stability.toFixed(1))}</span><span>{t('难度 {0} / 10',queue.data.progress[queue.current.id].fsrs!.difficulty.toFixed(1))}</span><span>{t('预计记住概率 {0}%',Math.round((retrievability(queue.data.progress[queue.current.id],queue.data.schedulerConfig??DEFAULT_SCHEDULER,queue.now)??0)*100))}</span></div>}<p>{t('到期')} · {queue.data.progress[queue.current.id]?.due ?? t('新卡')}</p>
        {historyLoading&&<p role="status">{t('准备中…')}</p>}{historyError&&<p role="alert">{localizedMessage(historyError)}</p>}
        <ul className="study-preview-list">{history.map(r=><li key={r.id}><time>{new Date(r.timestamp).toLocaleString()}</time><span>{t(({1:'重来',3:'困难',4:'良好',5:'简单'} as Record<number,string>)[r.quality])}{r.undone?` · ${t('已撤销')}`:''}</span></li>)}</ul>
        <p>{t('显示最近 20 条新版本评分记录。')}</p><button className="btn-secondary" onClick={()=>setDetails(false)}>{t('关闭')}</button>
      </section></div>}
    </section>
  )
}
