import { localizedMessage, t } from '../lib/i18n'
import { useId, useRef, useState } from 'react'
import { generationQueue } from '../lib/generationQueue'
import { loadLLMConfig } from '../lib/storage'
import type { Card } from '../types'


interface Props {
  targetTags?: string[]; targetDeckId?: string
  onAdded?: (card: Card) => void
  onJumpToCard?: (cardId: string) => void
  onViewTasks?: () => void
}

export function AIGenerateForm({ onViewTasks, targetTags = [], targetDeckId = 'default' }: Props) {
  const inputId = useId()
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [front, setFront] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enqueued, setEnqueued] = useState<string | null>(null)

  async function handleGenerate() {
    const word = front.trim()
    if (!word) {
      setError(t("请输入要学习的英文内容"))
      return
    }
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(null)
    try { const config = await loadLLMConfig(); if (!config?.baseURL.trim() || !config.model.trim() || !config.apiKey.trim()) throw new Error('请先在设置页配置 AI 模型 API'); await generationQueue.enqueue(word, undefined, targetDeckId, targetTags) } catch (e) { setError(String(e)); return } finally { submitting.current = false; setBusy(false) }
    setEnqueued(word)
    setFront(current => current.trim() === word ? '' : current)
  }

  return <form className="app-surface ai-generate" onSubmit={event => { event.preventDefault(); void handleGenerate() }}>
    <header>
      <h2>{t('AI 生成学习卡片')}</h2>
      <p className="ai-generate-copy">{t('输入英文单词、短语或句子，生成正反向记忆卡片。')}</p>
    </header>
    <div>
      <label className="ai-generate-input" htmlFor={inputId}>{t('学习内容')}
        <textarea id={inputId} className="app-field" rows={4} value={front}
          aria-describedby={`${inputId}-hint`}
          onChange={event => { setFront(event.target.value); setError(null) }}
          placeholder={t('输入一个单词、短语或完整句子…')} />
      </label>
      <div className="ai-generate-examples">
        <span>{t('试试')}</span>
        {['serendipity', 'break the ice', 'Every cloud has a silver lining.'].map(example =>
          <button type="button" key={example} onClick={() => { setFront(example); setError(null); document.getElementById(inputId)?.focus() }}>{example}</button>)}
      </div>
    </div>
    <div className="ai-generate-actions">
      <p id={`${inputId}-hint`} className="ai-generate-copy">{t('每次提交一项内容，使用设置中的 AI 模型生成。')}</p>
      <button className="btn-primary" disabled={busy || !front.trim()}>{t(busy ? '提交中…' : '生成卡片')}</button>
    </div>
    {enqueued && <p role="status" className="status-info">{t('已提交「{0}」，可继续添加内容。', enqueued)}</p>}
    {error && <p role="alert" className="status-error">{localizedMessage(error)}</p>}
    {onViewTasks && <footer className="ai-generate-tasks">
      <p className="ai-generate-copy">{t('生成后需逐张审核，确认后才进入卡片库。')}</p>
      <button type="button" onClick={onViewTasks}>{t('查看进度与审核')} <span aria-hidden="true">→</span></button>
    </footer>}
  </form>
}
