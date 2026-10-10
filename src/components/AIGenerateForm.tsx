import { localizedMessage, t } from '../lib/i18n'
import { useRef, useState } from 'react'
import { generationQueue } from '../lib/generationQueue'
import { loadLLMConfig } from '../lib/storage'
import type { Card } from '../types'


interface Props {
  onAdded?: (card: Card) => void
  onJumpToCard?: (cardId: string) => void
  onViewTasks?: () => void
}

export function AIGenerateForm({ onViewTasks }: Props) {
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [front, setFront] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enqueued, setEnqueued] = useState<string | null>(null)

  async function handleGenerate() {
    const word = front.trim()
    if (!word) {
      setError(t("请先输入一个英文单词"))
      return
    }
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(null)
    try { const config = await loadLLMConfig(); if (!config?.baseURL.trim() || !config.model.trim() || !config.apiKey.trim()) throw new Error('请先在设置页配置 AI 模型 API'); await generationQueue.enqueue(word) } catch (e) { setError(String(e)); return } finally { submitting.current = false; setBusy(false) }
    setEnqueued(word)
    setFront(current => current.trim() === word ? '' : current)
    setTimeout(() => setEnqueued((cur) => (cur === word ? null : cur)), 2500)
  }

  return <div className="space-y-4">
    <form className="app-surface space-y-4 p-5 sm:p-6" onSubmit={event => { event.preventDefault(); void handleGenerate() }}>
      <h2 className="font-semibold">{t('AI 生成')}</h2>
      <p className="text-sm text-slate-500">{t('生成结果需逐张审核，确认后才进入卡片库。')}</p>
      <label className="block text-sm font-semibold">{t('单词')}
        <input className="app-field mt-2" value={front} onChange={event => setFront(event.target.value)} placeholder={t('例如：serendipity')} />
      </label>
      <p className="text-sm text-slate-500">{t('任务使用设置中当前的 AI 模型。')}</p>
      <button className="btn-primary" disabled={busy || !front.trim()}>{t('AI 生成（后台）')}</button>
      {enqueued && <p role="status" className="status-info">{t('已加入后台队列：「{0}」，可继续提交下一个', enqueued)}</p>}
      {error && <p role="alert" className="status-error">{localizedMessage(error)}</p>}
    </form>
    <button className="btn-secondary" onClick={onViewTasks}>{t('查看任务队列')}</button>
  </div>
}
