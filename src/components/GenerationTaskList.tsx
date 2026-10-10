import { localizedMessage, t } from '../lib/i18n'
// Background generation task list. Shows queued/running/done/failed tasks
// with status badges, elapsed time, and a cancel button for active tasks.

import { useEffect, useRef, useState } from 'react'
import { useGenerationQueue } from '../hooks/useGenerationQueue'
import type { GenerationTask, TaskStatus } from '../lib/generationQueue'

const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'bg-slate-100 text-slate-600' },
  running: { label: '生成中', cls: 'bg-sky-100 text-sky-700' },
  paused: { label: '已暂停', cls: 'bg-slate-100' },
  review: { label: '待审核', cls: 'bg-sky-100' },
  cancelled: { label: '已取消', cls: 'bg-slate-100' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '失败', cls: 'bg-rose-100 text-rose-700' },
}

function formatElapsed(task: GenerationTask, now: number): string {
  if (task.status === 'queued') return ''
  const start = task.startedAt ?? task.enqueuedAt
  const end = task.finishedAt ?? now
  const s = Math.max(0, Math.round((end - start) / 1000))
  return `${s}s`
}

interface Props {
  /** Called when user clicks "查看" on a completed task. */
  onJumpToCard?: (cardId: string) => void
}

export function GenerationTaskList({ onJumpToCard }: Props) {
  const { tasks, cancel, resume } = useGenerationQueue()
  const pending = useRef(new Set<string>())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  async function action(id: string, work: () => Promise<void>) {
    if (pending.current.has(id)) return
    pending.current.add(id); setBusy(new Set(pending.current))
    setActionErrors(previous => ({ ...previous, [id]: '' }))
    try { await work() }
    catch (error) { setActionErrors(previous => ({ ...previous, [id]: error instanceof Error ? error.message : String(error) })) }
    finally { pending.current.delete(id); setBusy(new Set(pending.current)) }
  }
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === 'running' || t.status === 'queued')
    if (!hasActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [tasks])

  if (tasks.length === 0) return null

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">{t("后台 AI 生成任务")}</h4>
      <ul className="space-y-1.5">
        {tasks.map((task) => {
          const meta = STATUS_META[task.status]
          const isActive = task.status === 'queued' || task.status === 'running'
          const canJump = task.status === 'done' && task.drafts.some(d => d.status === 'accepted') && onJumpToCard
          return (
            <li
              key={task.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-slate-800">{task.word}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                  {task.status === 'running' && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                  )}
                  {t(meta.label)}
                </span>
                {task.status !== 'queued' && (
                  <span className="shrink-0 text-xs text-slate-400">{formatElapsed(task, now)}</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {actionErrors[task.id] && <span role="alert" className="text-xs text-rose-500">{localizedMessage(actionErrors[task.id])}</span>}
                {task.status === 'failed' && task.error && (
                  <span className="max-w-[12rem] truncate text-xs text-rose-500" title={localizedMessage(task.error)}>
                    {localizedMessage(task.error)}
                  </span>
                )}
                {isActive && (
                  <button
                    disabled={busy.has(task.id)}
                    onClick={() => void action(task.id, () => cancel(task.id))}
                    className="rounded-md bg-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-300"
                  >{t("取消")}</button>
                )}
                {['failed', 'cancelled', 'paused'].includes(task.status) && (
                  <button type="button" disabled={busy.has(task.id)}
                    onClick={() => void action(task.id, () => resume(task.id))}
                    className="btn-secondary shrink-0"
                  >{t(task.status === 'paused' ? '继续' : '重试')}</button>
                )}
                {canJump && (
                  <button
                    onClick={() => onJumpToCard!(task.drafts.find(d => d.status === 'accepted')!.card.id)}
                    className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                  >{t("查看")}</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
