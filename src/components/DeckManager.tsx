import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Card, Deck } from '../types'
import { saveDeck, deleteDeck, moveCards } from '../lib/storage'
import { deckPath, inDeck, ancestors } from '../lib/decks'
import { t } from '../lib/i18n'

type Panel = { kind: 'manage' } | { kind: 'edit'; draft: Deck; creating: boolean } | { kind: 'move' } | { kind: 'delete'; deck: Deck } | { kind: 'choose' }
export function DeckManager({ decks, cards, active, onSelect, selected, onMoved, onChanged, children }: {
  decks: Deck[]; cards: Card[]; active: string | null; onSelect: (id: string | null) => void
  selected: string[]; onMoved: () => void; onChanged: () => void; children: ReactNode
}) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [target, setTarget] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const sorted = [...decks].sort((a, b) => deckPath(a.id, decks).localeCompare(deckPath(b.id, decks)))
  const destinations = sorted.filter(d => selected.some(id => (cards.find(c => c.id === id)?.deckId ?? 'default') !== d.id))
  function open(next: Panel) { trigger.current = document.activeElement as HTMLElement; setError(''); setPanel(next) }
  function close() { if (busy) return; setPanel(null); trigger.current?.focus() }
  useEffect(() => { if (panel && !dialog.current?.open) dialog.current?.showModal(); if (!panel) dialog.current?.close() }, [panel])
  async function run(action: () => Promise<void>, message: string, after?: () => void) {
    setBusy(true); setError('')
    try { await action(); onChanged(); after?.(); setNotice(message); setPanel(null); trigger.current?.focus() }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const create = () => setPanel({ kind: 'edit', draft: { id: crypto.randomUUID(), name: '', parentId: active ?? undefined }, creating: true })
  const navigation = <nav aria-label={t('牌组筛选')} className="deck-navigation">
    <button aria-current={active === null ? 'page' : undefined} onClick={() => { onSelect(null); if(panel?.kind === 'choose') close() }}><span>{t('全部卡片')}</span><small>{cards.length}</small></button>
    {sorted.filter(d => !ancestors(d.id, decks).slice(1).some(id => collapsed.has(id))).map(d => <div className="deck-tree-row" key={d.id} style={{ paddingLeft: Math.min(ancestors(d.id, decks).length - 1, 4) * 12 }}>
      {decks.some(child => child.parentId === d.id) ? <button className="deck-tree-toggle" aria-label={t('展开或折叠 {0}', d.name)} aria-expanded={!collapsed.has(d.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (!next.delete(d.id)) next.add(d.id); return next })}>{collapsed.has(d.id) ? '›' : '⌄'}</button> : <span className="deck-tree-spacer"/>}
      <button title={deckPath(d.id, decks)} aria-current={active === d.id ? 'page' : undefined} onClick={() => { onSelect(d.id); if(panel?.kind === 'choose') close() }}><span>{d.name}</span><small>{cards.filter(c => inDeck(c, d.id, decks)).length}</small></button>
    </div>)}
  </nav>
  return <>
    <div className="deck-library-heading"><h3>{t('卡片浏览')}</h3><button className="btn-ghost" onClick={() => open({ kind: 'manage' })}>{t('管理牌组')}</button></div>
    <div className="deck-mobile-bar"><button className="btn-secondary" onClick={() => open({ kind: 'choose' })}>{active ? deckPath(active, decks) : t('全部牌组')} ▾</button></div>
    {notice && <p className="deck-notice" role="status">{notice}<button aria-label={t('关闭')} onClick={() => setNotice('')}>×</button></p>}
    {selected.length > 0 && <div className="deck-selection"><span>{t('已选 {0} 张卡片', selected.length)}</span><button className="btn-secondary" onClick={() => { setTarget(''); open({ kind: 'move' }) }}>{t('移动到…')}</button></div>}
    <div className={`deck-library-layout ${decks.length <= 1 ? 'is-compact' : ''}`}>
      <aside className="deck-sidebar">{navigation}<button className="btn-ghost deck-create" onClick={() => { open({ kind: 'manage' }); create() }}>＋ {t('新建牌组')}</button></aside>
      <div className="deck-library-content">{children}</div>
    </div>
    <dialog ref={dialog} className="deck-dialog" aria-labelledby="deck-dialog-title" onCancel={e => { e.preventDefault(); close() }}>
      {panel && <><header><h2 id="deck-dialog-title">{t(panel.kind === 'edit' ? panel.creating ? '新建牌组' : '编辑牌组' : panel.kind === 'move' ? '移动卡片' : panel.kind === 'delete' ? '删除牌组' : panel.kind === 'choose' ? '选择牌组' : '管理牌组')}</h2><button className="btn-ghost" aria-label={t('关闭')} disabled={busy} onClick={close}>×</button></header>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {panel.kind === 'choose' && navigation}
      {panel.kind === 'manage' && <><div className="deck-manage-list">{sorted.map(d => <div key={d.id}><div><strong>{d.name}</strong><small>{deckPath(d.id, decks)} · {t('{0} 张卡片（包含子牌组）', cards.filter(c => inDeck(c, d.id, decks)).length)}</small></div><button className="btn-ghost" aria-label={t('编辑 {0}', d.name)} onClick={() => setPanel({ kind: 'edit', draft: { ...d }, creating: false })}>{t('编辑')}</button>{d.id !== 'default' && <button className="btn-ghost" aria-label={t('删除 {0}', d.name)} onClick={() => setPanel({ kind: 'delete', deck: d })}>{t('删除')}</button>}</div>)}</div><footer><button className="btn-primary" onClick={create}>＋ {t('新建牌组')}</button></footer></>}
      {panel.kind === 'edit' && <form onSubmit={e => { e.preventDefault(); void run(() => saveDeck({ ...panel.draft, name: panel.draft.name.trim() }), t('牌组已保存')) }}>
        <fieldset disabled={busy} className="deck-form"><label>{t('名称')}<input autoFocus className="app-field" required maxLength={120} value={panel.draft.name} onChange={e => setPanel({ ...panel, draft: { ...panel.draft, name: e.target.value } })}/></label>
        <label>{t('所属牌组')}<select className="app-field" disabled={panel.draft.id === 'default'} value={panel.draft.parentId ?? ''} onChange={e => setPanel({ ...panel, draft: { ...panel.draft, parentId: e.target.value || undefined } })}><option value="">{t('顶层')}</option>{sorted.filter(d => !ancestors(d.id, decks).includes(panel.draft.id)).map(d => <option key={d.id} value={d.id}>{deckPath(d.id, decks)}</option>)}</select></label>
        <label>{t('每日新卡上限')}<select className="app-field" value={panel.draft.newCardsPerDay === undefined ? 'none' : 'limit'} onChange={e => setPanel({ ...panel, draft: { ...panel.draft, newCardsPerDay: e.target.value === 'none' ? undefined : 20 } })}><option value="none">{t('不单独限制')}</option><option value="limit">{t('设置上限')}</option></select></label>
        {panel.draft.newCardsPerDay !== undefined && <label>{t('每天最多')}<input className="app-field" type="number" required min={0} max={100000} step={1} value={panel.draft.newCardsPerDay} onChange={e => setPanel({ ...panel, draft: { ...panel.draft, newCardsPerDay: Number(e.target.value) } })}/></label>}
        <p className="deck-help">{t('仍受全局和上级牌组的每日上限约束。0 表示暂停发放新卡。')}</p></fieldset>
        <footer><button type="button" className="btn-secondary" disabled={busy} onClick={close}>{t('取消')}</button><button className="btn-primary" disabled={busy || !panel.draft.name.trim()}>{t(busy ? '保存中…' : '保存')}</button></footer>
      </form>}
      {panel.kind === 'move' && <><p className="deck-help">{t('将选中的 {0} 张卡片移动到目标牌组，保留学习进度。', selected.length)}</p>{destinations.length ? <label className="deck-form">{t('目标牌组')}<select className="app-field" value={target} onChange={e => setTarget(e.target.value)}><option value="" disabled>{t('请选择目标牌组')}</option>{destinations.map(d => <option key={d.id} value={d.id}>{deckPath(d.id, decks)}</option>)}</select></label> : <p className="deck-help">{t('暂无其他牌组，请先新建牌组。')}</p>}<footer><button className="btn-secondary" disabled={busy} onClick={create}>{t('新建牌组')}</button><button className="btn-primary" disabled={busy || !destinations.some(d => d.id === target)} onClick={() => { const ids = selected.filter(id => (cards.find(c => c.id === id)?.deckId ?? 'default') !== target); void run(() => moveCards(ids, target), t('已将 {0} 张卡片移至 {1}', ids.length, deckPath(target, decks)), onMoved) }}>{t(busy ? '移动中…' : '确认移动')}</button></footer></>}
      {panel.kind === 'delete' && <><p className="deck-help">{t('删除「{0}」后，直属卡片移至默认牌组，学习进度保留；子牌组提升一级。', panel.deck.name)}</p><footer><button className="btn-secondary" disabled={busy} onClick={close}>{t('取消')}</button><button className="btn-primary" disabled={busy} onClick={() => void run(() => deleteDeck(panel.deck.id), t('牌组已删除'), () => { if(active === panel.deck.id) onSelect(null) })}>{t('确认删除')}</button></footer></>}
      </>}
    </dialog>
  </>
}
