import { AppSelect } from './AppSelect'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Deck } from '../types'
import { loadDecks, saveDeck } from '../lib/storage'
import { ancestors, deckPath } from '../lib/decks'
import { t } from '../lib/i18n'

export function DeckEditor({ deck, decks, onSaved, onClose }: { deck?: Deck; decks: Deck[]; onSaved: (deck: Deck) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Deck>(() => deck ?? { id: crypto.randomUUID(), name: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus() } }, [])
  return createPortal(<dialog ref={dialog} className="deck-dialog" aria-label={t('编辑牌组')} onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!lock.current) onClose() }}>
    <form onSubmit={async e => { e.preventDefault(); e.stopPropagation(); if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { const saved = { ...draft, name: draft.name.trim() }; await saveDeck(saved); onSaved(saved) } catch (e) { setError(String(e)) } finally { lock.current = false; setBusy(false) } }}>
      <h2>{t(decks.some(d => d.id === draft.id) ? '编辑牌组' : '新建牌组')}</h2>
      <fieldset disabled={busy} className="deck-form"><label>{t('名称')}<input autoFocus required maxLength={120} className="app-field" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <details open={!!draft.parentId || draft.newCardsPerDay !== undefined}><summary>{t('可选设置')}</summary>
      <label>{t('父牌组')}<AppSelect label={t('父牌组')} disabled={draft.id === 'default'} value={draft.parentId ?? ''} onChange={value => setDraft({ ...draft, parentId: value || undefined })} options={[{ value: '', label: t('顶层') }, ...decks.filter(d => !ancestors(d.id, decks).includes(draft.id)).map(d => ({ value: d.id, label: deckPath(d.id, decks) }))]} /></label>
      <label>{t('每日新卡上限')}<input type="number" min={0} max={100000} step={1} placeholder={t('不单独限制')} className="app-field" value={draft.newCardsPerDay ?? ''} onChange={e => setDraft({ ...draft, newCardsPerDay: e.target.value === '' ? undefined : Number(e.target.value) })}/></label><p className="deck-help">{t('仍受全局和上级牌组的每日上限约束。0 表示暂停发放新卡。')}</p></details></fieldset>
      {error && <p role="alert">{error}</p>}<footer><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn-primary" disabled={busy || !draft.name.trim()}>{t(busy ? '保存中…' : '保存')}</button></footer>
    </form>
  </dialog>, document.body)
}

export function DeckPicker({ value, onChange, allowRoot = false, disabled = false, decks: suppliedDecks, onManage }: { onManage?: () => void; decks?: Deck[]; value: string; onChange: (id: string) => void; allowRoot?: boolean; disabled?: boolean }) {
  const [loadedDecks, setDecks] = useState<Deck[]>([]), [creating, setCreating] = useState(false), [error, setError] = useState('')
  const decks = suppliedDecks ?? loadedDecks
  useEffect(() => { if (suppliedDecks) return; let alive = true; const refresh = () => { void loadDecks().then(ds => { if (alive) { setDecks(ds); setError('') } }).catch(e => { if (alive) setError(String(e)) }) }; refresh(); window.addEventListener('vibe-library-changed', refresh); return () => { alive = false; window.removeEventListener('vibe-library-changed', refresh) } }, [suppliedDecks])
  return <div className="deck-picker"><label className="deck-picker-select"><span>{t(allowRoot ? '挂到现有牌组下' : '牌组')}</span><AppSelect value={value} placeholder={t('牌组不存在，请重新选择')} onChange={onChange} disabled={disabled} label={t(allowRoot ? '挂到现有牌组下' : '牌组')} options={[...(allowRoot ? [{ value: '', label: t('顶层') }] : []), ...decks.map(deck => ({ value: deck.id, label: deckPath(deck.id, decks) }))]}/></label><button type="button" className="btn-secondary" disabled={disabled} onClick={onManage ?? (() => setCreating(true))}>{onManage ? t('管理牌组') : `＋ ${t('新建牌组')}`}</button>{error && <p role="alert">{error}</p>}{creating && <DeckEditor decks={decks} onClose={() => setCreating(false)} onSaved={deck => { setDecks(ds => [...ds.filter(d => d.id !== deck.id), deck]); onChange(deck.id); setCreating(false) }}/>}</div>
}
