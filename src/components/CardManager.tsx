import type { LibrarySnapshot, StudyDetailsSnapshot } from '../hooks/useLibrarySnapshot'
import { isNew, isDue } from '../lib/sm2'
import { available } from '../lib/study'
import { DeckManager } from './DeckManager'
import { deckPath, inDeck } from '../lib/decks'
import { scopeLabel } from './TagSelector'
import { AnkiNoteEditor } from './AnkiNoteEditor'
import { matchesTag, matchesStudyScope, normalizeTags } from '../lib/tags'
import { t } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteCard, allCards } from '../lib/cardStore'
import { cardsToObsidianMd, downloadMarkdown } from '../lib/export'
import { addDays, todayKey } from '../lib/date'
import { loadStudyData, setCardControl } from '../lib/storage'
import { FILTERS, matchesStudy } from '../lib/study'
import type { Card, Deck, StudyData, StudyFilter, StudyScope } from '../types'
import { StudyDetailsPage, type StudyDetails } from './StudyDetailsPage'
import { StatsBar } from './StatsBar'
import { StudyHub } from './StudyHub'
import { CardsJSONAction } from './CardsJSONAction'
import { ActivityHeatmap } from './ActivityHeatmap'
import { Markdown } from './Markdown'
import { useCardEditor } from './CardEditor'
import { SpeakButton } from './SpeakButton'


export type CardsSection = 'today' | 'history' | 'library'

interface Props {
  history: StudyDetailsSnapshot | null
  historyError: string | null
  snapshot: LibrarySnapshot | null
  loadError: string | null
  section: CardsSection
  onDeckStudy: (id: string) => void
  onOpenDetails: (page: StudyDetails) => void
  onStudy?: (scope: StudyScope) => void
  onTagStudy: (scope: StudyScope) => void
  onEditScope: () => void
  onResume: () => void
  onBrowse: (cards: Card[]) => void
  sessionScope: StudyScope
  canResume?: boolean
  refreshKey: number
  onChanged?: () => void
  highlightCardId?: string | null
  onHighlightConsumed?: () => void
}

interface Group {
  label: string
  cards: Card[]
}

function groupCardsByDate(cards: Card[]): Group[] {
  // Newest first.
  const sorted = [...cards].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  const today = todayKey()
  const yesterday = addDays(today, -1)
  const weekAgo = addDays(today, -7)
  const monthAgo = addDays(today, -30)

  const groups: Record<string, Card[]> = {
    今天: [],
    昨天: [],
    本周: [],
    本月: [],
    更早: [],
    未知: [],
  }

  for (const c of sorted) {
    if (c.createdAt == null) {
      groups['未知'].push(c)
      continue
    }
    const t = todayKey(new Date(c.createdAt * 1000))
    if (t >= today) groups['今天'].push(c)
    else if (t >= yesterday) groups['昨天'].push(c)
    else if (t >= weekAgo) groups['本周'].push(c)
    else if (t >= monthAgo) groups['本月'].push(c)
    else groups['更早'].push(c)
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, cards: list }))
}

function matchesQuery(card: Card, q: string): boolean {
  if (!q) return true
  const haystack = `${card.front}\n${card.back}\n${card.example ?? ''}`.toLowerCase()
  return haystack.includes(q.toLowerCase())
}

export function CardManager({ history, historyError, snapshot, loadError, section, onDeckStudy, onOpenDetails, onStudy, onBrowse, onTagStudy, onEditScope, onResume, sessionScope, canResume, refreshKey, onChanged, highlightCardId, onHighlightConsumed }: Props) {
  const [studyData,setStudyData]=useState<StudyData|null>(snapshot?.data ?? null)
  const [decks, setDecks] = useState<Deck[]>(snapshot?.decks ?? [])
  const [activeDeck, setActiveDeck] = useState<string | null>(null)
  const [studyFilter,setStudyFilter]=useState<StudyFilter>('all')
  const [cards, setCards] = useState<Card[]>(snapshot?.cards ?? [])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const openEditor = useCardEditor()
  const [flashId, setFlashId] = useState<string | null>(null)
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map())

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const deleteInFlight = useRef(false)

  useEffect(() => {
    if (deleteTarget && !deleteDialog.current?.open) deleteDialog.current?.showModal()
    if (!deleteTarget) deleteDialog.current?.close()
  }, [deleteTarget])
  const tags = [...new Set(cards.flatMap(card => normalizeTags(card.tags)))].sort((a, b) => a.localeCompare(b))
  const [defaultScope, setDefaultScope] = useState<StudyScope>(snapshot?.settings.studyScope ?? null)
  const [scopeReady, setScopeReady] = useState(Boolean(snapshot))
  const scopedCards = cards.filter(card => matchesStudyScope(card, defaultScope))

  // Default-expanded group labels.
  const DEFAULT_OPEN: Record<string, boolean> = {
    今天: true,
    昨天: true,
    本周: true,
    本月: false,
    更早: false,
    未知: false,
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(DEFAULT_OPEN)

  function toggleCard(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !(prev[label] ?? DEFAULT_OPEN[label] ?? false) }))
  }

  function isOpen(label: string): boolean {
    return openGroups[label] ?? DEFAULT_OPEN[label] ?? false
  }

  function setAllOpen(open: boolean) {
    setOpenGroups({
      今天: open,
      昨天: open,
      本周: open,
      本月: open,
      更早: open,
      未知: open,
    })
  }

  useEffect(() => {
    if (!snapshot) return
    setCards(snapshot.cards)
    setStudyData(snapshot.data)
    setDecks(snapshot.decks)
    setActiveDeck(id => snapshot.decks.some(d => d.id === id) ? id : null)
    setDefaultScope(snapshot.settings.studyScope ?? null)
    setScopeReady(true)
  }, [snapshot])

  useEffect(() => {
    if (section !== 'library' || studyFilter !== 'forgotten') return
    let cancelled = false
    void loadStudyData().then(data => {
      if (!cancelled) setStudyData(data)
    }).catch(error => { if (!cancelled) setSaveError(String(error)) })
    return () => { cancelled = true }
  }, [section, studyFilter, snapshot])

  useEffect(() => {
    if (!highlightCardId) return
    const el = cardRefs.current.get(highlightCardId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(highlightCardId)
    onHighlightConsumed?.()
    const timer = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightCardId, cards, openGroups, expandedIds, onHighlightConsumed, section])

  const filteredCards = useMemo(() => {
    return section === 'library' ? cards.filter((c) => inDeck(c, activeDeck, decks) && matchesTag(c, tag) && matchesQuery(c, query.trim()) && (!studyData || matchesStudy(c,studyFilter,studyData.progress,studyData.controls,studyData.reviews))) : []
  }, [section, cards, query, tag,studyData,studyFilter,activeDeck,decks])

  const deckCards = cards.filter(c => inDeck(c, activeDeck, decks) && (!studyData || available(studyData.controls[c.id])))
  const hasFilters = activeDeck !== null || Boolean(query.trim()) || tag !== null || studyFilter !== 'all'
  const selectedVisibleCount = filteredCards.filter(card => selectedIds.has(card.id)).length

  const groups = useMemo(() => groupCardsByDate(filteredCards), [filteredCards])

  // When searching, force-expand all groups that have matches so results are visible.
  useEffect(() => {
    if (!query.trim()) return
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const g of groups) next[g.label] = true
      return next
    })
  }, [query, groups])

  useEffect(() => {
    if (!highlightCardId) return
    setActiveDeck(null)
    setQuery('')
    setTag(null)
    setStudyFilter('all')
  }, [highlightCardId])

  // When jumping to a highlighted card, ensure its group is open.
  useEffect(() => {
    if (!highlightCardId) return
    const target = filteredCards.find((c) => c.id === highlightCardId)
    if (!target) return
    setExpandedIds((prev) => new Set(prev).add(target.id))
    const group = groups.find((g) => g.cards.some((c) => c.id === target.id))
    if (group) {
      setOpenGroups((prev) => ({ ...prev, [group.label]: true }))
    }
  }, [highlightCardId, filteredCards, groups])

  function startEdit(card: Card) {
    openEditor({ kind: 'card', id: card.id, onSaved: onChanged })
  }

  async function handleDelete() {
    if (!deleteTarget || deleteInFlight.current) return
    deleteInFlight.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteCard(deleteTarget.id)
      await refresh()
      setDeleteTarget(null)
      onChanged?.()
    } catch (error) {
      setDeleteError(String(error))
    } finally {
      deleteInFlight.current = false
      setDeleting(false)
    }
  }

  async function refresh() {
    setCards(await allCards())
  }

  function enterSelectMode() {
    setSelectMode(true)
    setSelectedIds(new Set())
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select-all only operates on the currently visible (filtered) cards.
  const visibleIds = useMemo(() => filteredCards.map((c) => c.id), [filteredCards])
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  const exportTargets = useMemo<Card[]>(() => {
    if (!selectMode) return filteredCards
    return filteredCards.filter((c) => selectedIds.has(c.id))
  }, [filteredCards, selectMode, selectedIds])

  function handleExport() {
    if (exportTargets.length === 0) return
    const md = cardsToObsidianMd(exportTargets)
    const date = new Date().toISOString().slice(0, 10)
    const suffix = selectMode || query.trim() ? `-${exportTargets.length}` : ''
    downloadMarkdown(md, `vibe-word-${date}${suffix}.md`)
  }

  return (
    <div className="space-y-6">
      <dialog ref={deleteDialog} className="deck-dialog" aria-labelledby="delete-card-title"
        onCancel={event => { event.preventDefault(); if (!deleteInFlight.current) setDeleteTarget(null) }}>
        {deleteTarget && <>
          <header><h2 id="delete-card-title">{t('确认删除')}</h2></header>
          <p className="break-words">{t('确定删除「{0}」？相关学习进度也会被清除。', deleteTarget.front)}</p>
          {deleteError && <p role="alert" className="mt-3 text-red-600">{deleteError}</p>}
          <footer>
            <button type="button" className="btn-secondary" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('取消')}</button>
            <button type="button" className="btn-danger" disabled={deleting} onClick={() => void handleDelete()}>{t('确认删除')}</button>
          </footer>
        </>}
      </dialog>
      {loadError && <p role="alert" className="text-red-600">{loadError}</p>}
      {section === 'today' && <div className="space-y-6">
      <StatsBar stats={snapshot?.stats} />
      <StudyHub onOpenDetails={onOpenDetails}
        quickStudy={<><button className="btn-secondary" disabled={!scopeReady} onClick={() => onTagStudy(defaultScope)}>{t("按标签学习")}</button><button className="btn-secondary" onClick={() => onBrowse(cards)} disabled={cards.length === 0}>{t("快速学习")}</button></>}>
        <div className="study-launch">
          <p className="library-scope study-scope-label">{t("学习范围：{0}", scopeReady ? scopeLabel(defaultScope) : t("准备中…"))} <button className="study-quiet" onClick={onEditScope}>{t("修改")}</button></p>
          {scopeReady && scopedCards.length === 0 && <p className="section-copy">{t("没有匹配卡片，请选择其他标签")}</p>}
          <div className="library-session-actions">
            {onStudy && <button className="study-start-button study-session-button" onClick={() => onStudy(defaultScope)} disabled={!scopeReady || scopedCards.length === 0}>
              <span className="study-start-icon" aria-hidden="true">▶</span>{t("开始学习")}
            </button>}
            {canResume && <button className="btn-secondary study-scope-label study-session-button" onClick={onResume}>{t("继续上次学习 · {0}", scopeLabel(sessionScope))}</button>}
          </div>
        </div>
      </StudyHub>
      </div>}
      {section === 'history' && <div className="space-y-6">
        <ActivityHeatmap refreshKey={refreshKey} />
        <StudyDetailsPage snapshot={history} loadError={historyError} page="stats" embedded onAhead={() => {}} onExit={() => {}} />
      </div>}
      {section === 'library' && <section className="library-browser app-surface" aria-label={t("卡片浏览")}>
        <DeckManager decks={decks} cards={cards} active={activeDeck} onSelect={id => { setActiveDeck(id); exitSelectMode() }} selected={filteredCards.filter(c => selectedIds.has(c.id)).map(c => c.id)} onMoved={exitSelectMode} onChanged={() => onChanged?.()}>
        <div className="deck-current"><div><h4>{activeDeck ? deckPath(activeDeck, decks) : t('全部卡片')}</h4>{activeDeck && studyData && <p>{t('新卡 {0} · 学习中 {1} · 已到期 {2}', deckCards.filter(c => isNew(studyData.progress[c.id])).length, deckCards.filter(c => studyData.progress[c.id]?.learningDue != null).length, deckCards.filter(c => isDue(studyData.progress[c.id])).length)}</p>}{activeDeck && <p>{t('包含子牌组 · 学习使用整个牌组，浏览筛选不影响学习范围')}</p>}</div>{activeDeck && <button className="btn-primary" disabled={!cards.some(c => inDeck(c, activeDeck, decks))} onClick={() => onDeckStudy(activeDeck)}>{t('学习此牌组')}</button>}<CardsJSONAction kind="exportCards" /></div>
        <div className="library-controls" aria-label={t("卡片筛选与操作")}>
        <div className="library-filters">
          <div className="library-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
              aria-label={t("搜索单词、释义或例句…")} placeholder={t("搜索单词、释义或例句…")} className="app-field" />
            {query && <button onClick={() => setQuery('')} aria-label={t("清除搜索")} className="library-search-clear">✕</button>}
          </div>
          <label className="library-filter"><span>{t("标签")}</span>
            <select className="app-field browse-select" aria-label={t("按标签筛选")} value={tag === null ? 'all' : `tag:${tag}`}
              onChange={event => setTag(event.target.value === 'all' ? null : event.target.value.slice(4))}>
              <option value="all">{t("全部卡片")}</option>
              <option value="tag:">{t("未打标签")}</option>
              {tags.map(value => <option key={value} value={`tag:${value}`}>{value}</option>)}
              {tag && !tags.includes(tag) && <option value={`tag:${tag}`}>{tag}</option>}
            </select>
          </label>
          <label className="library-filter"><span>{t('卡片状态')}</span>
            <select className="app-field browse-select" aria-label={t("卡片状态")} value={studyFilter} onChange={e => setStudyFilter(e.target.value as StudyFilter)}>
              {FILTERS.map(f => <option key={f.value} value={f.value}>{t(f.label)}</option>)}
            </select>
          </label>
        </div>

        </div>

      {/* Toolbar */}
      <div className="library-toolbar">
        <div className="library-result-summary">
        <p aria-live="polite" className="text-xs text-slate-500">
          {selectMode
            ? t("已选 {0} / {1}", selectedVisibleCount, filteredCards.length)
            : hasFilters
            ? t("匹配 {0} / {1} 张", filteredCards.length, cards.length)
            : t("共 {0} 张卡片", cards.length)}
        </p>
        {hasFilters && <button className="library-reset" onClick={() => { setQuery(''); setTag(null); setStudyFilter('all'); setActiveDeck(null); exitSelectMode() }}>{t("清除筛选")}</button>}
        </div>
        <div className="card-manager-actions">
          {selectMode ? (
            <>
              <button
                onClick={toggleSelectAll}
                disabled={filteredCards.length === 0}
                className="btn-ghost text-xs"
              >
                {allSelected ? t("取消全选") : t("全选")}
              </button>
              <button
                onClick={handleExport}
                disabled={selectedVisibleCount === 0}
                className="btn-primary px-3 py-1.5 text-xs"
              >{t("导出选中（{0}）", selectedVisibleCount)}
              </button>
              <button
                onClick={exitSelectMode}
                className="card-manager-action card-manager-action-export"
              >{t("退出")}</button>
            </>
          ) : (
            <>
              <button
                onClick={enterSelectMode}
                disabled={filteredCards.length === 0}
                className="card-manager-action card-manager-action-export"
              >{t("批量选择")}</button>
              <button
                onClick={handleExport}
                disabled={filteredCards.length === 0}
                className="card-manager-action card-manager-action-export"
              >
                {hasFilters ? t("导出筛选结果") : t("全部导出")}
              </button>
            </>
          )}
          {groups.length > 1 && (
            <>
              <button
                onClick={() => setAllOpen(true)}
                className="card-manager-action"
              >{t("全部展开")}</button>
              <button
                onClick={() => setAllOpen(false)}
                className="card-manager-action"
              >{t("全部折叠")}</button>
            </>
          )}
        </div>
      </div>

      {/* Empty states */}
      {cards.length === 0 && (
        <p className="app-surface-muted p-6 text-center text-sm text-slate-500">{t("还没有卡片，先去「添加」页面创建吧")}</p>
      )}
      {saveError && <p role="alert" className="text-red-600">{saveError}</p>}
      {cards.length > 0 && filteredCards.length === 0 && (
        <p className="app-surface-muted p-6 text-center text-sm text-slate-500">{t("没有符合筛选条件的卡片")}</p>
      )}

      {/* Grouped list */}
      <div className="space-y-3">
        {groups.map((group) => {
          const open = isOpen(group.label)
          return (
            <section key={group.label} className="space-y-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-200/70"
                aria-expanded={open}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                    clipRule="evenodd"
                  />
                </svg>
                <h3 className="text-sm font-semibold text-slate-700">{t(group.label)}</h3>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500">{group.cards.length}</span>
              </button>
              {open && (
                <ul className="library-list">
                  {group.cards.map((card) => {
                    const expanded = expandedIds.has(card.id)
                    const isFlashing = flashId === card.id
                    const isSelected = selectedIds.has(card.id)
                    return (
                      <li
                        key={card.id}
                        ref={(el) => {
                          if (el) cardRefs.current.set(card.id, el)
                          else cardRefs.current.delete(card.id)
                        }}
                        onClick={selectMode ? () => toggleSelected(card.id) : undefined}
                        className={`library-row ${expanded ? 'is-expanded' : ''}  ${
                          isFlashing ? 'is-flashing' : isSelected ? 'is-selected' : ''
                        } ${selectMode ? 'cursor-pointer' : ''}`}
                      >
                      <div>
                        <div className="library-summary">
                        {selectMode && (
                          <input
                            type="checkbox"
                            aria-label={card.front}
                            checked={isSelected}
                            onChange={() => toggleSelected(card.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                          />
                        )}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleCard(card.id)
                          }}
                          className="library-toggle"
                        >
                          <span aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
                          <span className="library-title">{card.front.split(/\r\n|\r|\n/)[0]}</span>
                        </button>
                        </div>
                        {normalizeTags(card.tags).length > 0 && (
                          <div className="library-tags">{normalizeTags(card.tags).map(value => <span key={value}>{value}</span>)}</div>
                        )}
                        {expanded && <div className="library-details">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Markdown content={card.front} className="min-w-0 break-words font-semibold text-slate-900" />
                            {/^[a-zA-Z]/.test(card.front) && (
                              <SpeakButton text={card.front} lang="en" />
                            )}
                          </div>
                          {card.anki && <AnkiNoteEditor card={card} onSaved={onChanged} />}
                          <Markdown content={card.back} className="mt-1 text-sm leading-6 text-slate-600" />
                          {card.example && (
                            <div className="library-example">
                              <p className="whitespace-pre-line text-sm italic leading-6 text-slate-500">{card.example}</p>
                              <SpeakButton text={card.example} lang="en" className="shrink-0" />
                            </div>
                          )}
                        </div>
                        {!selectMode && (
                          <div className="library-actions">
                            <button
                              onClick={() => startEdit(card)}
                              className="btn-ghost px-2.5 py-1 text-xs"
                            >{t("编辑")}</button>
                            <button className="btn-secondary" onClick={async()=>{try{await setCardControl(card.id,{suspended:!studyData?.controls[card.id]?.suspended});setStudyData(await loadStudyData());onChanged?.()}catch(e){setSaveError(String(e))}}}>{studyData?.controls[card.id]?.suspended?t('恢复学习'):t('暂停')}</button>
                            <button className="btn-secondary" onClick={async()=>{try{await setCardControl(card.id,{marked:!studyData?.controls[card.id]?.marked});setStudyData(await loadStudyData());onChanged?.()}catch(e){setSaveError(String(e))}}}>{studyData?.controls[card.id]?.marked?t('取消标记'):t('标记')}</button>
                            <button
                              onClick={() => { setDeleteError(null); setDeleteTarget(card) }}
                              className="btn-danger px-2.5 py-1 text-xs"
                            >{t("删除")}</button>
                          </div>
                        )}
                        </div>}
                      </div>
                  </li>
                )
              })}
                </ul>
              )}
            </section>
          )
        })}
      </div>
      </DeckManager>
      </section>}
    </div>
  )
}
