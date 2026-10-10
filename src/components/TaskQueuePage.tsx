import { useEffect, useState } from 'react'
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
  const [filter, setFilter] = useState('review'), [selected, setSelected] = useState<string | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [guidance, setGuidance] = useState('')
  const openEditor = useCardEditor()
  const [decks, setDecks] = useState<Deck[]>([])
  useEffect(() => { void loadDecks().then(setDecks).catch(e => setError(String(e))) }, [])
  useEffect(() => { void generationQueue.initialize().catch(e => setError(String(e))) }, [])
  const visible = tasks.filter(task => filter === 'review' ? task.drafts.some(d => d.status === 'ready') : filter === 'active' ? ['queued', 'running'].includes(task.status) : filter === 'attention' ? ['failed', 'paused'].includes(task.status) : ['done', 'cancelled'].includes(task.status))
  const rows = visible.flatMap<{ task: GenerationTask; draft?: CardDraft; key: string }>(task => {
    const drafts = filter === 'review' ? task.drafts.filter(d => d.status === 'ready') : task.drafts
    return drafts.length ? drafts.map(draft => ({ task, draft, key: draft.id })) : [{ task, draft: undefined, key: task.id }]
  })
  const current = rows.find(row => row.key === selected) ?? rows[0]
  const task = current?.task, draft = current?.draft
  async function action(work: () => Promise<unknown>, advance = false) {
    if (busy) return
    setBusy(true); setError('')
    try { await work(); if (advance) { setSelected(null); onChanged() } }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  function rowLabel(task: GenerationTask, draft?: CardDraft) {
    return draft ? `${draft.card.front} · ${t(draft.direction === 'enToCn' ? '正向卡' : draft.direction === 'cnToEn' ? '反向卡' : '新版本')}` : task.word
  }
  return <section className="task-page" data-block-study-shortcuts>
    <header className="task-header"><div><h1>{t('任务队列')}</h1><p>{t('生成结果需逐张审核，确认后才进入卡片库。')}</p></div><button className="btn-secondary" disabled={busy} onClick={() => void action(() => generationQueue.clearFinished())}>{t('清理已结束记录')}</button></header>
    <div className="task-filters" role="group" aria-label={t('筛选任务')}>{[['review', '待审核'], ['active', '进行中'], ['attention', '需处理'], ['finished', '已结束']].map(([key, label]) => <button key={key} className={filter === key ? 'btn-primary' : 'btn-secondary'} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelected(null); setMobileDetail(false); setError('') }}>{t(label)}</button>)}</div>
    {(error || generationQueue.error) && <p className="status-error" role="alert">{localizedMessage(error || generationQueue.error!)}<button className="btn-secondary" onClick={() => void action(() => generationQueue.initialize())}>{t('重新加载')}</button></p>}
    <div className={`task-layout${mobileDetail && current ? ' task-show-detail' : ''}`}>
      <aside className="app-surface task-list" aria-label={t('任务列表')}>
        {!visible.length && <p className="section-copy">{t('此状态下暂无任务')}</p>}
        {visible.map(task => <section key={task.id}><h2>{task.word}</h2><p className="section-copy">{t(TASK_LABELS[task.status])} · {new Date(task.enqueuedAt).toLocaleString()}{task.document && ` · ${task.document.analyzed}/${task.document.document.sections.length}`}</p>
          {rows.filter(row => row.task.id === task.id).map(row => <button key={row.key} aria-current={current?.key === row.key ? 'true' : undefined} className="task-row" onClick={() => { setSelected(row.key); setMobileDetail(true); setGuidance(''); setError('') }}><span>{rowLabel(task, row.draft)}</span>{row.draft && <small>{t(row.draft.status === 'ready' ? '待审核' : row.draft.status === 'accepted' ? '已入库' : '已丢弃')}</small>}</button>)}
        </section>)}
      </aside>
      <article className="app-surface task-detail">
        {current ? <>
          <button className="btn-secondary task-back" onClick={() => setMobileDetail(false)}>{t('‹ 返回')}</button>
          <h2>{t(task!.kind === 'replacement' ? '审核新版本' : '审核卡片')}</h2>
          <p className="section-copy">{t(task!.kind === 'document' ? '导入文件' : task!.kind === 'replacement' ? '重新生成卡片' : 'AI 生成')} · {task!.model ?? ''} · {t(TASK_LABELS[task!.status])}</p>
          {task!.requirements && <details><summary>{t('生成要求')}</summary><p className="whitespace-pre-wrap">{task!.requirements}</p></details>}
          {task!.document && <p>{t('已生成 {0} 张卡片', task!.drafts.length)}</p>}
          {task!.error && <p role="alert" className="status-error">{localizedMessage(task!.error)}</p>}
          {task!.warning && <p className="status-info">{localizedMessage(task!.warning)}</p>}
          <div className="task-actions">
            {['running', 'queued'].includes(task!.status) && <><button className="btn-secondary" disabled={busy} onClick={() => void action(() => generationQueue.pause(task!.id))}>{t('暂停')}</button><button className="btn-secondary" disabled={busy} onClick={() => void action(() => generationQueue.cancel(task!.id))}>{t('取消生成')}</button></>}
            {['failed', 'paused', 'cancelled'].includes(task!.status) && <button className="btn-primary" disabled={busy} onClick={() => void action(() => generationQueue.resume(task!.id))}>{t(task!.status === 'paused' ? '继续' : '重试')}</button>}
          </div>
          {draft && <>
            {task!.kind === 'replacement' && task!.expected && <details><summary>{t('查看原卡片')}</summary><Markdown content={task!.expected.front} /><Markdown content={task!.expected.back} /></details>}
            {(['front', 'back', 'example'] as const).map((side, i) => draft.card[side] && <section className="task-face" key={side}><h3>{t(['正面', '背面', '例句'][i])}</h3><Markdown content={draft.card[side]!} /></section>)}
            <p className="section-copy">{t('牌组')} · {deckPath(draft.card.deckId ?? 'default', decks)} · {t('标签')} · {(draft.card.tags ?? []).join(', ')}</p>
            {draft.source && <details><summary>{t('原文出处')} · {draft.source.label}</summary>{draft.source.imageId && <SourceImage id={draft.source.imageId} />}<blockquote>{draft.quote}</blockquote><p className="whitespace-pre-wrap">{draft.source.text}</p></details>}
            {draft.status === 'ready' && <>
              <div className="task-actions"><button className="btn-secondary" disabled={busy} onClick={() => openEditor({ kind: 'draft', taskId: task!.id, draftId: draft.id })}>{t('编辑草稿')}</button><button className="btn-danger" disabled={busy} onClick={() => void action(() => generationQueue.discard(task!.id, draft.id), true)}>{t('丢弃草稿')}</button><button className="btn-primary" disabled={busy} onClick={() => void action(() => generationQueue.confirm(task!.id, draft.id), true)}>{t(task!.kind === 'replacement' ? '确认替换' : '确认入库')}</button></div>
              <p className="section-copy">{t(task!.kind === 'replacement' ? '确认后替换原卡，学习进度保留。' : '仅确认当前这张卡片，其他草稿继续等待审核。')}</p>
              <details><summary>{t('重新生成草稿')}</summary><label>{t('生成要求')}<textarea className="app-field" rows={3} value={guidance} onChange={e => setGuidance(e.target.value)} /></label><button className="btn-secondary" disabled={busy} onClick={() => void action(async () => { await generationQueue.enqueueDraft(task!.id, draft.id, guidance); setGuidance('') })}>{t('提交重新生成任务')}</button></details>
            </>}
          </>}
        </> : <p className="section-copy">{t('选择任务查看详情')}</p>}
      </article>
    </div>
  </section>
}
