import { WorkspaceBreadcrumb } from './WorkspaceToolbar'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Card, Deck } from '../types'
import { deleteDeck, moveCards } from '../lib/storage'
import { deckPath, inDeck, ancestors } from '../lib/decks'
import { t } from '../lib/i18n'
import { DeckEditor, DeckPicker } from './DeckEditor'
import { TagManager } from './TagManager'

type Panel = { kind: 'move' } | { kind: 'collect'; id: string } | { kind: 'delete'; deck: Deck }
export function DeckManager({ decks, cards, active, onSelect, selected, onMoved, onChanged, children, onAdd, onStudy, studyCount, showAll, managementRequest, deckReturn, onTagSelect }: {
  decks: Deck[]; cards: Card[]; active: string | null; onSelect: (id: string | null) => void
  selected: string[]; onMoved: () => void; onChanged: () => void; children: ReactNode
  onTagSelect: (tag: string) => void
  managementRequest: { view: 'decks' | 'tags'; revision: number } | null
  deckReturn: { id: string; revision: number } | null
  onAdd: (id: string) => void; onStudy: (id: string) => void; studyCount: (id: string) => number; showAll?: string | null
}) {
  const [view, setView] = useState<'decks' | 'cards' | 'tags'>('cards')
  const [panel, setPanel] = useState<Panel | null>(null), [editing, setEditing] = useState<Deck | null>(null)
  const [target, setTarget] = useState('default'), [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([]), [collapsed, setCollapsed] = useState(new Set<string>())
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false)
  const previousActive = useRef(active)
  useEffect(() => { if (showAll) { setView('cards'); onSelect(null) } }, [showAll]) // Card search jumps must reveal the full library.
  useEffect(() => { if (previousActive.current && !decks.some(d => d.id === previousActive.current)) { onSelect(null); setNotice(t('牌组已删除')) }; previousActive.current = active }, [active, decks])
  useEffect(() => { if (!panel) return; const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus() } }, [panel?.kind])
  useEffect(() => { if (deckReturn) { setView('decks'); onSelect(decks.some(d => d.id === deckReturn.id) ? deckReturn.id : null) } }, [deckReturn])
  useEffect(() => { if (managementRequest) { setView(managementRequest.view); onSelect(null) } }, [managementRequest])
  const sorted = [...decks].sort((a,b) => deckPath(a.id,decks).localeCompare(deckPath(b.id,decks)))
  const current = decks.find(d => d.id === active)
  function create(parentId?: string) { setEditing({ id: crypto.randomUUID(), name: '', parentId }) }
  function choose(id: string | null) { onSelect(id); setQuery(''); onMoved() }
  function open(next: Panel) { setError(''); setQuery(''); setPicked([]); setPanel(next) }
  async function run(work: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work(); onChanged(); onMoved(); setPanel(null) } catch(e) { setError(String(e)) } finally { lock.current = false; setBusy(false) } }
  const tree = (items: Deck[]) => <nav className="deck-navigation" aria-label={t('牌组')}>{items.map(d => <div className="deck-tree-row" key={d.id} style={{ paddingLeft: active ? 0 : Math.min(ancestors(d.id,decks).length - 1,4) * 12 }}>
    {!active && decks.some(child => child.parentId === d.id) && <button className="deck-tree-toggle" aria-label={t('展开或折叠 {0}', d.name)} aria-expanded={!collapsed.has(d.id)} onClick={() => setCollapsed(old => { const next = new Set(old); if (!next.delete(d.id)) next.add(d.id); return next })}>{collapsed.has(d.id) ? '›' : '⌄'}</button>}
    <button onClick={() => choose(d.id)}><span>{d.name}</span><small>{t('{0} 张 · 今日可学 {1}', cards.filter(c => inDeck(c,d.id,decks)).length, studyCount(d.id))}</small></button>
  </div>)}</nav>
  const collecting = panel?.kind === 'collect' ? cards.filter(c => (c.deckId ?? 'default') !== panel.id && `${c.front}\n${c.back}`.toLowerCase().includes(query.toLowerCase())) : []
  return <>
    <WorkspaceBreadcrumb page="library"><nav aria-label={t('当前位置')}>
      <span>{t('内容')}</span><span aria-hidden="true">/</span>
      {view === 'cards' && !current ? <span aria-current="page">{t('卡片库')}</span> : <button aria-label={t('返回卡片库')} onClick={() => { setView('cards'); choose(null) }}>{t('卡片库')}</button>}
      {view !== 'cards' && <><span aria-hidden="true">/</span><button onClick={() => choose(null)} aria-current={!current ? 'page' : undefined}>{t(view === 'decks' ? '牌组' : '标签')}</button></>}
      {view !== 'tags' && current && ancestors(current.id, decks).reverse().map(id => <span className="workspace-crumb" key={id}><span aria-hidden="true">/</span>{id === current.id ? <span aria-current="page">{current.name}</span> : <button aria-label={t('返回 {0}', decks.find(d => d.id === id)?.name ?? id)} onClick={() => choose(id)}>{decks.find(d => d.id === id)?.name ?? id}</button>}</span>)}
    </nav></WorkspaceBreadcrumb>
    <header className="deck-library-heading">
      {view === 'cards' ? <h3>{t('卡片库')}</h3> : <button className="btn-ghost" onClick={() => setView('cards')}>‹ {t('返回卡片库')}</button>}
      <div className="deck-library-tools">
        {view === 'cards' && <><button className="btn-ghost" onClick={() => setView('decks')}>{t('管理牌组')}</button><button className="btn-ghost" onClick={() => setView('tags')}>{t('管理标签')}</button></>}
        {view === 'decks' && <button className="btn-secondary" onClick={() => create()}>＋ {t('新建牌组')}</button>}
      </div>
    </header>
    {view === 'tags' && <TagManager cards={cards} onChanged={() => { onSelect(null); onChanged() }} onBrowse={tag => { onTagSelect(tag); setView('cards') }} />}
    {notice && <p role="status">{notice}</p>}
    {view === 'decks' && !active && <><p className="deck-help">{t('按主题整理卡片，选择牌组开始学习。')}</p>{tree(sorted.filter(d => !ancestors(d.id,decks).slice(1).some(id => collapsed.has(id))))}</>}
    {view === 'decks' && current && <section className="deck-detail">
      <button className="btn-ghost" onClick={() => choose(null)}>{t('‹ 返回牌组')}</button><h2>{deckPath(current.id,decks)}</h2>
      <p>{t('{0} 张 · 今日可学 {1}', cards.filter(c => inDeck(c,current.id,decks)).length, studyCount(current.id))}</p>
      <p className="deck-help">{t('包含子牌组 · 学习使用整个牌组，浏览筛选不影响学习范围')}</p>
      <div className="deck-actions"><button className="btn-primary" disabled={studyCount(current.id) === 0} onClick={() => onStudy(current.id)}>{t(studyCount(current.id) ? '开始学习' : '今日已完成')}</button><button className="btn-secondary" onClick={() => onAdd(current.id)}>{t('添加卡片')}</button><button className="btn-secondary" onClick={() => open({ kind:'collect', id:current.id })}>{t('从现有卡片移入')}</button>
      <details><summary>{t('管理牌组')}</summary><div className="deck-actions"><button className="btn-secondary" onClick={() => setEditing(current)}>{t('编辑牌组')}</button><button className="btn-secondary" onClick={() => create(current.id)}>{t('新建子牌组')}</button>{current.id !== 'default' && <button className="btn-secondary" onClick={() => open({ kind:'delete', deck:current })}>{t('删除牌组（保留卡片）')}</button>}</div></details></div>
      {tree(sorted.filter(d => d.parentId === current.id))}
      <button className="btn-ghost" onClick={() => setView('cards')}>{t('浏览牌组卡片')} →</button>
      {!cards.some(c => inDeck(c,current.id,decks)) && <p className="deck-help">{t('这个牌组还没有卡片，添加新卡片或从卡片库移入。')}</p>}
    </section>}
    {view === 'cards' && <>{selected.length > 0 && <div className="deck-selection"><span>{t('已选 {0} 张卡片',selected.length)}</span><button className="btn-secondary" onClick={() => { setTarget('default'); open({kind:'move'}) }}>{t('移动到…')}</button></div>}{children}</>}
    {editing && <DeckEditor deck={editing} decks={decks} onClose={() => setEditing(null)} onSaved={deck => { onChanged(); setEditing(null); setView('decks'); choose(deck.id) }}/>}
    <dialog ref={dialog} className="deck-dialog" aria-label={t('管理牌组')} onCancel={e => { e.preventDefault(); if (!busy) setPanel(null) }}>{panel && <>
      <header><h2>{t(panel.kind === 'delete' ? '删除牌组' : panel.kind === 'collect' ? '从现有卡片移入' : '移动卡片')}</h2></header>
      {panel.kind === 'move' && <DeckPicker value={target} onChange={setTarget} disabled={busy}/>}
      {panel.kind === 'collect' && <><input className="app-field" aria-label={t('搜索卡片')} placeholder={t('搜索卡片')} value={query} disabled={busy} onChange={e => setQuery(e.target.value)}/><div className="deck-collect">{collecting.map(c => <label key={c.id}><input type="checkbox" disabled={busy} checked={picked.includes(c.id)} onChange={e => setPicked(ids => e.target.checked ? [...ids,c.id] : ids.filter(id => id !== c.id))}/><span>{c.front}</span></label>)}{!collecting.length && <p>{t('没有匹配的卡片')}</p>}</div></>}
      {panel.kind === 'delete' && <p>{t('删除「{0}」后，直属卡片移至默认牌组，学习进度保留；子牌组提升一级。',panel.deck.name)}</p>}
      {error && <p role="alert">{error}</p>}<footer><button className="btn-secondary" disabled={busy} onClick={() => setPanel(null)}>{t('取消')}</button><button className="btn-primary" disabled={busy || (panel.kind === 'collect' && !picked.length)} onClick={() => void run(async () => { if (panel.kind === 'delete') { await deleteDeck(panel.deck.id); choose(null) } else { await moveCards(panel.kind === 'move' ? selected : picked,panel.kind === 'move' ? target : panel.id) }; setNotice(t(panel.kind === 'delete' ? '牌组已删除' : '卡片已移动')) })}>{t(busy ? '保存中…' : panel.kind === 'delete' ? '确认删除' : '确认移动')}</button></footer>
    </>}</dialog>
  </>
}
