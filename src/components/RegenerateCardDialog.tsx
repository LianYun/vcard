import { useEffect, useRef, useState } from 'react'
import type { Card } from '../types'
import { generationQueue } from '../lib/generationQueue'
import { localizedMessage, t } from '../lib/i18n'
import { Markdown } from './Markdown'
export function RegenerateCardDialog({ card, onClose }: { card: Card; onClose: () => void; onSaved: () => void }) {
  const [requirements, setRequirements] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} className="study-modal regenerate-modal ai-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="regenerate-title" onCancel={e => { e.preventDefault(); if (!busy) onClose() }}>
    <header className="regenerate-header"><h2 id="regenerate-title">{t('重新生成卡片')}</h2><button aria-label={t('关闭')} disabled={busy} onClick={onClose}>×</button></header>
    <div className="regenerate-body"><Markdown content={card.front} /><label>{t('你的要求（选填）')}<textarea autoFocus className="app-field" rows={4} value={requirements} onChange={e => setRequirements(e.target.value)} /></label><p>{t('生成任务将在后台执行，请到任务队列审核后确认替换。')}</p>{error && <p role="alert" className="status-error">{localizedMessage(error)}</p>}</div>
    <footer className="regenerate-footer"><button className="btn-secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn-primary" disabled={busy} onClick={() => { if (busy) return; setBusy(true); void generationQueue.enqueueReplacement(card, requirements).then(() => { window.dispatchEvent(new CustomEvent('vibe-ai-submitted')); onClose() }).catch(e => { setError(String(e)); setBusy(false) }) }}>{t(busy ? '保存中…' : '提交任务')}</button></footer>
  </dialog>
}
