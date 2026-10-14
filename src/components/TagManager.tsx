import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Card } from '../types'
import { normalizeTags } from '../lib/tags'
import { useLibraryTags } from '../hooks/useLibraryTags'
import { createLibraryTag, replaceLibraryTag } from '../lib/storage'
import { localizedMessage, t } from '../lib/i18n'

export function TagManager({ cards, onBrowse, onChanged }: { cards: Card[]; onBrowse: (tag: string) => void; onChanged: () => void }) {
  const [query, setQuery] = useState(''), [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [edit, setEdit] = useState<{ tag: string; deleting: boolean } | null>(null)
  const counts = new Map<string, number>()
  for (const card of cards) for (const tag of normalizeTags(card.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  const { tags, error } = useLibraryTags([...counts.keys()])
  const visible = tags.filter(tag => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="tag-manager">
    <div className="tag-manager-heading"><div><h2>{t('管理标签')}</h2><p className="section-copy">{t('创建和整理标签，添加或编辑卡片时可选择使用。')}</p></div><button className="btn-primary" onClick={() => setCreating(true)}>＋ {t('创建标签')}</button></div>
    {error && <p role="alert">{localizedMessage(error)}</p>}
    <input type="search" className="app-field" aria-label={t('搜索标签')} placeholder={t('搜索标签')} value={query} onChange={e => setQuery(e.target.value)} />
    {notice && <p role="status">{notice}</p>}
    <p className="section-copy">{t('共 {0} 个标签', tags.length)}</p>
    <div className="tag-manager-list">{visible.map(tag => <div className="tag-manager-row" key={tag}>
      <button className="tag-manager-name" onClick={() => onBrowse(tag)}><strong>{tag}</strong><small>{t('包含 {0} 张卡片', counts.get(tag) ?? 0)}</small></button>
      <div className="tag-manager-actions"><button className="btn-ghost" aria-label={t('重命名标签：{0}', tag)} onClick={() => setEdit({ tag, deleting: false })}>{t('重命名')}</button><button className="btn-ghost" aria-label={t('删除标签：{0}', tag)} onClick={() => setEdit({ tag, deleting: true })}>{t('删除')}</button></div>
    </div>)}</div>
    {!visible.length && <p className="section-copy">{t(tags.length ? '没有匹配的标签' : '暂无标签，创建一个标签开始整理。')}</p>}
    {creating && <TagCreateDialog tags={tags} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setQuery(''); setNotice(t('标签已创建')); onChanged() }} />}
    {edit && <TagEditDialog tag={edit.tag} deleting={edit.deleting} tags={tags} count={counts.get(edit.tag) ?? 0} onClose={() => setEdit(null)} onChanged={onChanged} onSaved={() => { setEdit(null); setNotice(t(edit.deleting ? '标签已删除' : '标签已更新')) }} />}
  </section>
}

function TagEditDialog({ tag, deleting, tags, count, onClose, onChanged, onSaved }: { tag: string; deleting: boolean; tags: string[]; count: number; onClose: () => void; onChanged: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false)
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus() } }, [])
  const merging = name.trim() !== tag && tags.includes(name.trim())
  return createPortal(<dialog className="deck-dialog" ref={dialog} aria-label={t(deleting ? '删除标签' : '重命名标签')} onCancel={e => { e.preventDefault(); if (!lock.current) onClose() }}>
    <form onSubmit={async e => { e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await replaceLibraryTag(tag, deleting ? null : name); onSaved() } catch (reason) { setError(localizedMessage(String(reason))) } finally { onChanged(); lock.current = false; setBusy(false) } }}>
      <h2>{t(deleting ? '删除标签' : '重命名标签')}</h2>
      <p className="section-copy">{deleting ? t('从 {1} 张卡片移除「{0}」，保留卡片和学习进度。', tag, count) : t('将更新 {0} 张卡片上的标签，并同步默认学习范围。', count)}</p>
      {!deleting && <label className="deck-form">{t('标签名称')}<input autoFocus required className="app-field" disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label>}
      {merging && !deleting && <p role="status">{t('该标签已存在，保存后将合并标签。')}</p>}
      {error && <p role="alert">{error}<br />{t('部分卡片可能已更新，请重试以完成操作。')}</p>}
      <footer><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn-primary" disabled={busy || (!deleting && (!name.trim() || name.trim() === tag))}>{t(busy ? '保存中…' : deleting ? '确认删除' : '保存')}</button></footer>
    </form>
  </dialog>, document.body)
}

function TagCreateDialog({ tags, onClose, onSaved }: { tags: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false)
  useEffect(() => { const previous = document.activeElement as HTMLElement; const element = dialog.current; element?.showModal(); return () => { element?.close(); previous?.focus() } }, [])
  const duplicate = tags.includes(name.trim())
  return createPortal(<dialog className="deck-dialog" ref={dialog} aria-label={t('创建标签')} onCancel={e => { e.preventDefault(); if (!lock.current) onClose() }}>
    <form onSubmit={async e => { e.preventDefault(); if (lock.current || !name.trim() || duplicate) return; lock.current = true; setBusy(true); setError(''); try { await createLibraryTag(name); onSaved() } catch (reason) { setError(localizedMessage(String(reason))) } finally { lock.current = false; setBusy(false) } }}>
      <h2>{t('创建标签')}</h2>
      <label className="deck-form">{t('标签名称')}<input autoFocus required className="app-field" disabled={busy} value={name} onChange={e => { setName(e.target.value); setError('') }} /></label>
      {duplicate && <p role="status">{t('该标签已存在')}</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn-primary" disabled={busy || !name.trim() || duplicate}>{t(busy ? '保存中…' : '创建标签')}</button></footer>
    </form>
  </dialog>, document.body)
}
