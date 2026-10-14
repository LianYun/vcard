import { AppSelect } from './AppSelect'
import { useEffect, useId, useRef, useState } from 'react'
import { useGenerationQueue } from '../hooks/useGenerationQueue'
import { generationQueue } from '../lib/generationQueue'
import type { CardDraft, GenerationTask } from '../lib/aiTaskTypes'
import { useCardEditor } from './CardEditor'
import { Markdown } from './Markdown'
import type { Deck } from '../types'
import { deckPath } from '../lib/decks'
import { loadDecks, loadImportImage } from '../lib/storage'
import { localizedMessage, t } from '../lib/i18n'

export const TASK_LABELS = { queued: '排队中', running: '生成中', paused: '已暂停', review: '待审核', done: '已结束', failed: '失败', cancelled: '已取消' }
function SourceImage({ id }: { id: string }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('')
  useEffect(() => { let alive = true; loadImportImage(id).then(s => { if (alive) setSrc(s) }).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [id])
  return error ? <p role="alert">{localizedMessage(error)}</p> : src ? <img src={src} alt={t('原文出处')} /> : <p>{t('准备中…')}</p>
}
export function TaskQueuePage({ onChanged }: { onChanged: () => void }) {
  const { tasks } = useGenerationQueue()
  const [filter, setFilter] = useState('review')
  const [search, setSearch] = useState('')
  const [selectedTask, setSelectedTask] = useState<string | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null)
  const detailBody = useRef<HTMLDivElement>(null)
  const directionTabs = useRef<(HTMLButtonElement | null)[]>([])
  const panelId = useId()
  const actionPending = useRef(false)
  const [mobileDetail, setMobileDetail] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<GenerationTask | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (deleteTarget && !deleteDialog.current?.open) deleteDialog.current?.showModal()
    if (!deleteTarget) deleteDialog.current?.close()
  }, [deleteTarget])
  function requestDelete(item: GenerationTask) { setError(''); setDeleteTarget(item) }
  const [guidance, setGuidance] = useState('')
  const openEditor = useCardEditor()
  const [decks, setDecks] = useState<Deck[]>([])
  useEffect(() => { const refresh = () => { void loadDecks().then(setDecks).catch(e => setError(String(e))) }; refresh(); window.addEventListener('vibe-library-changed', refresh); return () => window.removeEventListener('vibe-library-changed', refresh) }, [])
  useEffect(() => { void generationQueue.initialize().catch(e => setError(String(e))) }, [])
  const visible = tasks.filter(task => {
    // Keep the task just completed on screen until the user chooses another task/filter.
    const matchesStatus = filter === 'review' ? task.drafts.some(d => d.status === 'ready') || (task.id === selectedTask && task.status === 'done' && task.drafts.length > 0) : filter === 'active' ? ['queued', 'running'].includes(task.status) : filter === 'attention' ? ['failed', 'paused'].includes(task.status) : ['done', 'cancelled'].includes(task.status)
    return matchesStatus && task.word.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  }).sort((a, b) => b.enqueuedAt - a.enqueuedAt)
  const task = visible.find(item => item.id === selectedTask) ?? visible[0]
  const drafts = task?.drafts ?? []
  const draft = drafts.find(item => item.id === selectedDraft) ?? drafts.find(item => item.status === 'ready') ?? drafts[0]
  const draftIndex = drafts.findIndex(item => item.id === draft?.id)
  const hasDirectionTabs = drafts.length === 2 && drafts.some(item => item.direction === 'enToCn') && drafts.some(item => item.direction === 'cnToEn')
  const pendingCount = drafts.filter(item => item.status === 'ready').length
  const reviewComplete = task?.status === 'done' && drafts.length > 0 && pendingCount === 0
  useEffect(() => {
    detailBody.current?.scrollTo({ top: 0 })
    setGuidance('')
  }, [task?.id, draft?.id])

  async function action(work: () => Promise<unknown>, advance = false) {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true); setError('')
    try {
      await work()
      if (advance && task && draft) {
        // Advance within this task, keeping processed cards available for review.
        const latest = generationQueue.getSnapshot()
        const remaining = latest.find(item => item.id === task.id)?.drafts.filter(item => item.status === 'ready') ?? []
        const nextDraft = remaining.find(item => task.drafts.findIndex(d => d.id === item.id) > task.drafts.findIndex(d => d.id === draft.id)) ?? remaining[0]
        setSelectedTask(task.id)
        setSelectedDraft(nextDraft?.id ?? draft.id)
        onChanged()
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { actionPending.current = false; setBusy(false) }
  }
  function stopTask(id: string) {
    void action(async () => {
      await generationQueue.pause(id)
      setFilter('attention'); setSelectedTask(id); setSelectedDraft(null); setMobileDetail(false)
    })
  }
  function draftLabel(item: CardDraft) {
    return t(item.direction === 'enToCn' ? '英 → 中' : item.direction === 'cnToEn' ? '中 → 英' : '新版本')
  }
  function draftStatus(item: CardDraft) {
    return t(item.status === 'ready' ? '待审核' : item.status === 'accepted' ? '已入库' : '已丢弃')
  }
  function chooseDraft(id: string) { setSelectedTask(task.id); setSelectedDraft(id); setError('') }
  return <section className="task-page" data-block-study-shortcuts>
    <dialog ref={deleteDialog} className="deck-dialog" aria-labelledby={`${panelId}-delete-title`}
      onCancel={event => { event.preventDefault(); if (!actionPending.current) setDeleteTarget(null) }}>
      {deleteTarget && <>
        <header><h2 id={`${panelId}-delete-title`}>{t('删除任务')}</h2></header>
        <p className="break-words">{t('确定删除任务「{0}」？任务及其草稿将被移除，已入库的卡片会保留。此操作无法撤销。', deleteTarget.word)}</p>
        {error && <p role="alert" className="status-error">{localizedMessage(error)}</p>}
        <footer>
          <button className="btn-secondary" autoFocus disabled={busy} onClick={() => setDeleteTarget(null)}>{t('取消')}</button>
          <button className="btn-danger" disabled={busy} onClick={() => void action(async () => {
            await generationQueue.deleteTask(deleteTarget.id)
            setDeleteTarget(null); setSelectedTask(null); setSelectedDraft(null); setMobileDetail(false)
          })}>{t(busy ? '正在删除…' : '确认删除')}</button>
        </footer>
      </>}
    </dialog>
    {(error || generationQueue.error) && <p className="status-error" role="alert">{localizedMessage(error || generationQueue.error!)}<button className="btn-secondary" onClick={() => void action(() => generationQueue.initialize())}>{t('重新加载')}</button></p>}
    <div className={`task-layout${mobileDetail && task ? ' task-show-detail' : ''}`}>
      <aside className="app-surface task-list" aria-label={t('任务列表')}>
        <header className="task-list-header">
          <div className="task-list-title"><div><h2>{t('任务列表')}</h2><span>{t('{0} 个任务', visible.length)}</span></div><button className="btn-secondary" disabled={busy} onClick={() => void action(() => generationQueue.clearFinished())}>{t('清理已结束记录')}</button></div>
          <div className="task-filters" role="group" aria-label={t('筛选任务')}>{[['review', '待审核'], ['active', '进行中'], ['attention', '需处理'], ['finished', '已结束']].map(([key, label]) => <button key={key} disabled={busy} className={filter === key ? 'btn-primary' : 'btn-secondary'} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelectedTask(null); setSelectedDraft(null); setMobileDetail(false); setError('') }}>{t(label)}</button>)}</div>
          <input type="search" className="app-field" aria-label={t('搜索任务')} placeholder={t('搜索单词或任务…')} value={search} disabled={busy} onChange={e => { setSearch(e.target.value); setSelectedTask(null); setSelectedDraft(null); setMobileDetail(false); setError('') }} />
        </header>
        <div className="task-list-scroll" tabIndex={0} aria-label={t('任务列表')}>
          {!visible.length && <p className="section-copy task-empty">{t(search.trim() ? '没有匹配的任务' : '此状态下暂无任务')}</p>}
          {visible.map(item => <div key={item.id} className="task-row-container" data-selected={task?.id === item.id} data-action={filter === 'active' || filter === 'attention'}><button disabled={busy} aria-current={task?.id === item.id ? 'true' : undefined} className="task-row" onClick={() => { setSelectedTask(item.id); setSelectedDraft(null); setMobileDetail(true); setError('') }}>
            <span className="task-row-title"><strong title={item.word}>{item.word}</strong><small className={`task-status task-status-${item.status}`}>{t(TASK_LABELS[item.status])}</small></span>
            <span className="task-row-meta"><time dateTime={new Date(item.enqueuedAt).toISOString()}>{new Date(item.enqueuedAt).toLocaleString()}</time><span>{t('{0} 张待审核', item.drafts.filter(d => d.status === 'ready').length)}</span></span>
          </button>
          {filter === 'active' && <button className="task-row-action" title={t('停止')} disabled={busy} aria-label={t('停止任务「{0}」', item.word)} onClick={() => stopTask(item.id)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button>}
          {filter === 'attention' && <button className="task-row-action task-row-action-danger" title={t('删除任务')} disabled={busy} aria-label={t('删除任务「{0}」', item.word)} onClick={() => requestDelete(item)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button>}
          </div>)}
        </div>
        <p className="task-list-footer">{t('按创建时间倒序 · 每个任务独立展示')}</p>
      </aside>
      <article className="app-surface task-detail" aria-label={t('审核卡片')} aria-busy={busy}>
        {task ? <>
          <header className={`task-detail-header${hasDirectionTabs ? ' task-detail-header-tabs' : ''}`}>
            <button className="btn-secondary task-back" onClick={() => setMobileDetail(false)}>{t('‹ 返回')}</button>
            <p className="task-detail-eyebrow">{t(task.kind === 'replacement' ? '审核新版本' : '审核卡片')}</p>
            <div className="task-detail-title"><h2 title={task.word}>{task.word}</h2>{drafts.length > 0 && <span className="task-review-count" role="status">{t(reviewComplete ? '审核完成' : '{0} 张待审核', pendingCount)}</span>}</div>
            <p className="section-copy">{t(task.kind === 'document' ? '导入文件' : task.kind === 'replacement' ? '重新生成卡片' : 'AI 生成')} · {task.model ? `${task.model} · ` : ''}{t(TASK_LABELS[task.status])}</p>
            {hasDirectionTabs ? <div className="task-direction-tabs" role="tablist" aria-label={t('卡片方向')}>
              {drafts.map((item, i) => <button key={item.id} ref={el => { directionTabs.current[i] = el }} id={`${panelId}-tab-${i}`} type="button" role="tab" disabled={busy} className="task-direction-tab" aria-selected={draft?.id === item.id} aria-controls={panelId} tabIndex={draft?.id === item.id ? 0 : -1} onClick={() => chooseDraft(item.id)} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? drafts.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : drafts.length - 1)) % drafts.length
                chooseDraft(drafts[next].id)
                directionTabs.current[next]?.focus()
              }}>{draftLabel(item)}<span className={`task-direction-status task-direction-status-${item.status}`}>{draftStatus(item)}</span></button>)}
            </div> : drafts.length > 0 && <div className="task-draft-switcher" role="group" aria-label={t('选择草稿')}>
              {drafts.length === 1 ? <span className="task-single-draft">{draftLabel(drafts[0])} · {draftStatus(drafts[0])}</span> : <>
                <AppSelect label={t('选择草稿')} value={draft?.id ?? ''} disabled={busy} onChange={chooseDraft} options={drafts.map((item, i) => ({ value: item.id, label: `${i + 1}. ${draftLabel(item)} · ${item.card.front.slice(0, 80)} · ${draftStatus(item)}` }))} />
                <button className="btn-secondary" aria-label={t('上一张')} disabled={busy || draftIndex <= 0} onClick={() => chooseDraft(drafts[draftIndex - 1].id)}>‹</button>
                <button className="btn-secondary" aria-label={t('下一张')} disabled={busy || draftIndex >= drafts.length - 1} onClick={() => chooseDraft(drafts[draftIndex + 1].id)}>›</button>
              </>}
              {drafts.length > 1 && <span className="task-draft-count">{draftIndex + 1} / {drafts.length}</span>}
            </div>}
          </header>
          <div className="task-detail-body" id={panelId} role={hasDirectionTabs ? 'tabpanel' : undefined} aria-labelledby={hasDirectionTabs ? `${panelId}-tab-${draftIndex}` : undefined} ref={detailBody} tabIndex={0} aria-label={hasDirectionTabs ? undefined : t('卡片内容')}>
            {task.requirements && <details><summary>{t('生成要求')}</summary><p className="whitespace-pre-wrap">{task.requirements}</p></details>}
            {task.document && <p className="section-copy">{t('文档分析进度')} · {task.document.analyzed} / {task.document.document.sections.length} · {t('已生成 {0} 张卡片', task.drafts.length)}</p>}
            {task.error && <p role="alert" className="status-error">{localizedMessage(task.error)}</p>}
            {task.warning && <p className="status-info">{localizedMessage(task.warning)}</p>}
            <div className="task-actions">
              {['running', 'queued'].includes(task.status) && <><button className="btn-secondary" disabled={busy} onClick={() => stopTask(task.id)}>{t('停止')}</button><button className="btn-secondary" disabled={busy} onClick={() => void action(() => generationQueue.cancel(task.id))}>{t('取消生成')}</button></>}
              {['failed', 'paused'].includes(task.status) && <button className="btn-danger" disabled={busy} onClick={() => requestDelete(task)}>{t('删除任务')}</button>}
              {['failed', 'paused', 'cancelled'].includes(task.status) && <button className="btn-primary" disabled={busy} onClick={() => void action(() => generationQueue.resume(task.id))}>{t(task.status === 'paused' ? '继续' : '重试')}</button>}
            </div>
            {draft && <>
              {draft.direction !== 'replacement' && <p className="task-direction-hint">{t(draft.direction === 'enToCn' ? '看英文，回忆中文含义' : '看中文，回忆英文表达')}</p>}
              {task.kind === 'replacement' && task.expected && <details><summary>{t('查看原卡片')}</summary><Markdown content={task.expected.front} /><Markdown content={task.expected.back} /></details>}
              <div className="task-card-preview">{(['front', 'back', 'example'] as const).map((side, i) => draft.card[side] && <section className="task-face" key={side}><h3>{t(['题面', '答案', '例句'][i])}{i < 2 && <span>{t(i === 0 ? '学习时先展示' : '回忆后揭晓')}</span>}</h3><Markdown content={draft.card[side]!} /></section>)}</div>
              <p className="section-copy">{t('牌组')} · {deckPath(draft.card.deckId ?? 'default', decks)} · {t('标签')} · {(draft.card.tags ?? []).join(', ')}</p>
              {draft.source && <details><summary>{t('原文出处')} · {draft.source.label}</summary>{draft.source.imageId && <SourceImage id={draft.source.imageId} />}<blockquote>{draft.quote}</blockquote><p className="whitespace-pre-wrap">{draft.source.text}</p></details>}
              {draft.status === 'ready' && <>
                {!decks.some(d => d.id === (draft.card.deckId ?? 'default')) && <p role="alert">{t('牌组不存在，请重新选择')}</p>}
                <details><summary>{t('重新生成草稿')}</summary><label>{t('生成要求')}<textarea className="app-field" rows={3} value={guidance} onChange={e => setGuidance(e.target.value)} /></label><button className="btn-secondary" disabled={busy} onClick={() => void action(async () => { await generationQueue.enqueueDraft(task.id, draft.id, guidance); setGuidance('') })}>{t('提交重新生成任务')}</button></details>
              </>}
            </>}
          </div>
          {draft && <footer className="task-review-footer">
              {draft.status === 'ready' && <div className="task-actions"><button className="btn-secondary" disabled={busy} onClick={() => openEditor({ kind: 'draft', taskId: task.id, draftId: draft.id })}>{t('编辑草稿')}</button><button className="btn-danger" disabled={busy} onClick={() => void action(() => generationQueue.discard(task.id, draft.id), true)}>{t('丢弃草稿')}</button><button className="btn-primary" disabled={busy || !decks.some(d => d.id === (draft.card.deckId ?? 'default'))} onClick={() => void action(() => generationQueue.confirm(task.id, draft.id), true)}>{t(busy ? '正在保存…' : task.kind === 'replacement' ? '确认替换' : '入库当前卡')}</button></div>}
              <div className="task-review-scope"><p>{t('当前：{0}', draftLabel(draft))} · {draftStatus(draft)}</p><p className="section-copy">{t(reviewComplete ? '本任务审核完成，可切换查看已处理卡片。' : draft.status !== 'ready' ? '当前卡片已处理，请选择待审核卡片继续。' : task.kind === 'replacement' ? '确认后替换原卡，学习进度保留。' : '仅处理当前卡片，入库后继续下一张待审核卡。')}</p></div>
          </footer>}
        </> : <p className="section-copy task-empty">{t('选择任务查看详情')}</p>}
      </article>
    </div>
  </section>
}
