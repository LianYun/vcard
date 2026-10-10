import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Card, Deck } from '../types'
import type { ImportDraft } from '../lib/importTypes'
import { addCard, findCard } from '../lib/cardStore'
import { ensureProgressSync, loadProgress, saveOneProgress, loadDecks, saveEditedCard, previewAnkiEdit, replaceRegeneratedCard } from '../lib/storage'
import { generationQueue } from '../lib/generationQueue'
import { documentImports } from '../lib/documentImport'
import { normalizeTags, parseTags } from '../lib/tags'
import { deckPath } from '../lib/decks'
import { localizedMessage, t } from '../lib/i18n'
import { MarkdownEditor } from './MarkdownEditor'
import { ExampleEditor } from './ExampleEditor'
import { CardFace } from './CardView'

type Saved = () => void
export type EditorRequest =
  | { kind: 'draft'; taskId: string; draftId: string; onSaved?: Saved }
  | { kind: 'create'; onSaved?: Saved }
  | { kind: 'card'; id: string; onSaved?: Saved }
  | { kind: 'import'; jobId: string; draftId: string; cards: NonNullable<ImportDraft['cards']>; reverse: boolean; source: string; onSaved?: Saved }
  | { kind: 'proposal'; card: Card; draft: { front: string; back: string; example: string }; onSaved?: Saved }
const EditorContext = createContext<(request: EditorRequest) => void>(() => { throw new Error('CardEditorProvider missing') })
export const useCardEditor = () => useContext(EditorContext)
const emptyCard = (): Card => ({ id: '', front: '', back: '', example: '', tags: [], deckId: 'default' })
const reserved = new Set(['Tags', 'Deck', 'Subdeck', 'Type', 'Card'])

export function CardEditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EditorRequest | null>(null)
  return <EditorContext.Provider value={setRequest}>{children}{request && <CardEditor request={request} onClose={() => setRequest(null)} />}</EditorContext.Provider>
}

function CardEditor({ request, onClose }: { request: EditorRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const draftRevision = useRef(0)
  const originalImport = useRef<NonNullable<ImportDraft['cards']> | null>(null)
  const createdCard = useRef<Card | null>(null)
  const leaveDialog = useRef<HTMLDialogElement | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [original, setOriginal] = useState<Card[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [index, setIndex] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [initialFields, setInitialFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [continueAdding, setContinueAdding] = useState(true)
  const [notice, setNotice] = useState('')
  const [ankiPreview, setAnkiPreview] = useState<{ cards: Card[]; added: number; removed: number }>({ cards: [], added: 0, removed: 0 })
  const [ankiError, setAnkiError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const card = cards[index]
  const dirty = JSON.stringify(cards) !== JSON.stringify(original) || JSON.stringify(fields) !== JSON.stringify(initialFields)
  const title = request.kind === 'draft' ? '编辑草稿' : request.kind === 'create' ? '创建卡片' : request.kind === 'import' ? '编辑导入草稿' : request.kind === 'proposal' ? '编辑新版本' : '编辑卡片'
  const label = request.kind === 'draft' ? '保存草稿' : request.kind === 'create' ? '创建卡片' : request.kind === 'import' ? '保存草稿' : request.kind === 'proposal' ? '保存并替换' : card?.anki ? '保存笔记及卡片变化' : '保存修改'
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    let alive = true
    void (async () => {
      const ds = await loadDecks()
      let cs: Card[]
      if (request.kind === 'draft') {
        const draft = generationQueue.getSnapshot().find(t => t.id === request.taskId)?.drafts.find(d => d.id === request.draftId)
        if (!draft || draft.status !== 'ready') throw new Error('只能修改待审核卡片')
        draftRevision.current = draft.revision; cs = [draft.card]
      } else if (request.kind === 'card') {
        const current = await findCard(request.id)
        if (!current) throw new Error('卡片已删除，请刷新')
        cs = [current]
      } else if (request.kind === 'import') {
        const current = documentImports.getSnapshot().jobs.find(job => job.id === request.jobId)?.drafts.find(draft => draft.id === request.draftId)
        if (!current?.cards || current.status !== 'ready') throw new Error('只能修改待审核卡片')
        originalImport.current = structuredClone(current.cards)
        cs = [current.cards.enToCn, ...(request.reverse ? [current.cards.cnToEn] : [])]
      }
      else if (request.kind === 'proposal') cs = [{ ...request.card, ...request.draft }]
      else cs = [emptyCard()]
      if (!alive) return
      const drafts = structuredClone(cs)
      setCards(drafts); setOriginal(structuredClone(cs)); setTags(cs.map(c => normalizeTags(c.tags).join(', '))); setDecks(ds)
      setFields(cs[0].anki?.fields ?? {}); setInitialFields(cs[0].anki?.fields ?? {})
    })().catch(e => { if (alive) setError(localizedMessage(String(e))) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; dialog.current?.close(); previous?.focus() }
  }, [request])
  useEffect(() => {
    if (!dirty) return
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [dirty])
  useEffect(() => {
    if (!card?.anki) return
    let alive = true
    setPreviewBusy(true); setAnkiError('')
    const timer = setTimeout(() => {
      void previewAnkiEdit(card.id, fields).then(result => { if (alive) setAnkiPreview(result) }).catch(e => { if (alive) { setAnkiPreview({ cards: [], added: 0, removed: 0 }); setAnkiError(localizedMessage(String(e))) } }).finally(() => { if (alive) setPreviewBusy(false) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [card?.id, card?.anki, fields])
  function patch(value: Partial<Card>) { setCards(previous => previous.map((c, i) => i === index ? { ...c, ...value } : c)); setNotice('') }
  function close() { if (lock.current) return; if (dirty) setLeaving(true); else onClose() }
  async function save() {
    if (lock.current) return
    lock.current = true; setSaving(true); setError(''); setNotice('')
    try {
      if (request.kind === 'create') {
        if (!(await loadDecks()).some(deck => deck.id === (card.deckId ?? 'default'))) throw new Error('牌组不存在')
        const created = createdCard.current ?? await addCard(card.front, card.back, card.example, undefined, { tags: card.tags, deckId: card.deckId })
        createdCard.current = created
        const progress = ensureProgressSync(await loadProgress(), created.id)
        await saveOneProgress(progress[created.id])
      } else if (request.kind === 'draft') {
        await generationQueue.saveDraft(request.taskId, request.draftId, card, draftRevision.current)
      } else if (request.kind === 'import') {
        await documentImports.replace(request.jobId, request.draftId, { ...originalImport.current!, enToCn: cards[0], cnToEn: cards[1] ?? originalImport.current!.cnToEn }, originalImport.current!)
      } else if (request.kind === 'proposal') await replaceRegeneratedCard(request.card, { front: card.front, back: card.back, example: card.example ?? '' })
      else await saveEditedCard(original[0], card, card.anki ? fields : undefined)
      if (request.kind !== 'import' && request.kind !== 'draft') window.dispatchEvent(new Event('vibe-library-changed'))
      request.onSaved?.()
      if (request.kind === 'create' && continueAdding) {
        const next = { ...emptyCard(), deckId: card.deckId, tags: card.tags }
        createdCard.current = null
        setCards([next]); setOriginal([structuredClone(next)]); setNotice(t('卡片已创建，可以继续添加。'))
      } else onClose()
    } catch (e) { setError(localizedMessage(e instanceof Error ? e.message : String(e))) }
    finally { lock.current = false; setSaving(false) }
  }
  const valid = cards.length > 0 && (card?.anki ? !previewBusy && !ankiError && ankiPreview.cards.length > 0 : cards.every(c => c.front.trim() && (request.kind === 'import' || request.kind === 'proposal' ? c.back.trim() : true)))
  return <dialog ref={dialog} className="card-editor-page mac-app" data-block-study-shortcuts aria-labelledby="card-editor-title" onCancel={e => { e.preventDefault(); close() }}>
    <form onSubmit={e => { e.preventDefault(); void save() }}>
      <header className="card-editor-header"><button type="button" className="btn-secondary" disabled={saving} onClick={close}>{t('‹ 返回')}</button><h1 id="card-editor-title">{t(title)}</h1><button className="btn-primary" disabled={loading || saving || !valid || (request.kind !== 'create' && !dirty && request.kind !== 'proposal')}>{t(saving ? '保存中…' : label)}</button></header>
      {loading ? <p role="status">{t('准备中…')}</p> : card && <>
        {request.kind === 'proposal' && <p className="card-editor-note">{t('新版本 · 尚未替换原卡片，学习进度保留')}</p>}
        {request.kind === 'import' && <><div className="card-editor-directions">{cards.map((c, i) => <button key={c.id || i} type="button" className={index === i ? 'btn-primary' : 'btn-secondary'} aria-pressed={index === i} onClick={() => setIndex(i)}>{t(i === 0 ? '正向卡' : '反向卡')}</button>)}</div><details className="card-editor-source"><summary>{t('原文出处')}</summary><p>{request.source}</p></details><p className="card-editor-note">{t('保存草稿后返回审核，接受后才会入库。')}</p></>}
        <fieldset disabled={saving || !!createdCard.current} className="card-editor-meta"><span>{t('题型')} · {t(card.anki ? 'Anki 模板卡' : '问答卡')}</span>
          {request.kind !== 'import' && request.kind !== 'proposal' && <><label>{t('牌组')}<select className="app-field" value={card.deckId ?? 'default'} onChange={e => patch({ deckId: e.target.value })}>{decks.map(d => <option key={d.id} value={d.id}>{deckPath(d.id, decks)}</option>)}</select></label><label>{t('标签（用逗号分隔，清空可移除）')}<input className="app-field" value={tags[index] ?? ''} onChange={e => { setTags(prev => prev.map((v, i) => i === index ? e.target.value : v)); patch({ tags: parseTags(e.target.value) }) }} /></label></>}
        </fieldset>
        <div className="card-editor-columns"><span>{t('编辑内容')}</span><span>{t('实时预览')}</span></div>
        <div className="card-editor-layout" key={index}>
          {card.anki ? <div className="card-editor-pair card-editor-anki">
            <fieldset disabled={saving} className="card-editor-fields" ref={node => { if (node) node.inert = saving }}>
              <h2>{t('编辑 Anki 笔记')}</h2>
              <p className="card-editor-note">{t('修改会更新同一笔记的所有卡片。新增 Cloze 编号会创建新卡，移除编号会删除对应卡片；保留编号的学习进度不变。')}</p>
              {Object.entries(fields).filter(([name]) => !reserved.has(name)).map(([name, value]) => <label key={name}>{name}<textarea className="app-field" rows={5} value={value} onChange={e => setFields(prev => ({ ...prev, [name]: e.target.value }))} /></label>)}
            </fieldset>
            <aside className="card-editor-preview">
              <h2>{t('卡片预览')}</h2>
              {previewBusy && <p role="status">{t('准备中…')}</p>}
              {ankiError && <p role="alert" className="status-error">{ankiError}</p>}
              <p>{t('保存后共 {0} 张卡片', ankiPreview.cards.length)}</p>
              <p>{t('新增 {0} 张 · 删除 {1} 张', ankiPreview.added, ankiPreview.removed)}</p>
              {ankiPreview.cards.map(c => <div key={c.id} className="card-editor-anki-faces"><section className="app-surface"><h3>{t('正面')}</h3><CardFace card={c} editable={false} /></section><section className="app-surface"><h3>{t('背面')}</h3><CardFace card={c} back editable={false} /></section></div>)}
            </aside>
          </div> : (['front', 'back'] as const).map(side => <div key={side} className={`card-editor-pair card-editor-${side}`}>
            <fieldset disabled={saving || !!createdCard.current} className="card-editor-fields" ref={node => { if (node) node.inert = saving || !!createdCard.current }}>
              <section><h2>{t(side === 'front' ? '正面' : '背面')}{side === 'front' ? ' *' : ''}</h2>
                <MarkdownEditor label={t(side === 'front' ? '正面' : '背面')} value={card[side]} onChange={value => patch({ [side]: value })} />
              </section>
              {side === 'back' && <div className="card-editor-examples"><ExampleEditor value={card.example ?? ''} onChange={example => patch({ example })} /></div>}
            </fieldset>
            <aside className="card-editor-preview"><h2>{t(side === 'front' ? '正面预览' : '背面预览')}</h2>
              <div className="app-surface card-editor-face"><CardFace card={card} back={side === 'back'} editable={false} /></div>
            </aside>
          </div>)}
        </div>
        {request.kind === 'create' && <label className="card-editor-continue"><input type="checkbox" checked={continueAdding} disabled={saving} onChange={e => setContinueAdding(e.target.checked)} />{t('创建后继续添加')}</label>}
      </>}
      {error && <p role="alert" className="status-error">{error}</p>}{notice && <p role="status" className="status-success">{notice}</p>}
    </form>
    {leaving && <dialog ref={node => { leaveDialog.current = node; if (node && !node.open) node.showModal() }} className="card-editor-leave" aria-label={t('尚有未保存的修改')} onCancel={e => { e.preventDefault(); e.stopPropagation(); setLeaving(false) }}><p>{t('尚有未保存的修改')}</p><button autoFocus className="btn-primary" onClick={() => setLeaving(false)}>{t('继续编辑')}</button><button className="btn-secondary" onClick={onClose}>{t('放弃修改')}</button></dialog>}
  </dialog>
}
