import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteCard, updateCard, allCards } from '../lib/cardStore'
import { cardsToObsidianMd, downloadMarkdown } from '../lib/export'
import { createLogger } from '../lib/log'
import { deleteOneProgress } from '../lib/storage'
import type { Card } from '../types'
import { ActivityHeatmap } from './ActivityHeatmap'
import { Markdown } from './Markdown'
import { MarkdownEditor } from './MarkdownEditor'
import { SpeakButton } from './SpeakButton'

const log = createLogger('card-manager')

interface Props {
  refreshKey: number
  onChanged?: () => void
  highlightCardId?: string | null
  onHighlightConsumed?: () => void
}

interface Group {
  label: string
  cards: Card[]
}

// Bucket boundaries (in seconds since epoch) computed from local midnight.
function startOfTodaySec(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

function groupCardsByDate(cards: Card[]): Group[] {
  // Newest first.
  const sorted = [...cards].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  const today = startOfTodaySec()
  const yesterday = today - 86_400
  const weekAgo = today - 7 * 86_400
  const monthAgo = today - 30 * 86_400

  const groups: Record<string, Card[]> = {
    今天: [],
    昨天: [],
    本周: [],
    本月: [],
    更早: [],
    未知: [],
  }

  for (const c of sorted) {
    const t = c.createdAt
    if (t == null) {
      groups['未知'].push(c)
      continue
    }
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

export function CardManager({ refreshKey, onChanged, highlightCardId, onHighlightConsumed }: Props) {
  const [cards, setCards] = useState<Card[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ front: string; back: string; example: string }>({
    front: '',
    back: '',
    example: '',
  })
  const [flashId, setFlashId] = useState<string | null>(null)
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map())

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [query, setQuery] = useState('')

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
    allCards()
      .then((list) => {
        log.info('loaded cards', { count: list.length })
        setCards(list)
      })
      .catch((err) => log.error('loadCards failed', err))
  }, [refreshKey])

  useEffect(() => {
    if (!highlightCardId) return
    const el = cardRefs.current.get(highlightCardId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(highlightCardId)
    onHighlightConsumed?.()
    const timer = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightCardId, cards, onHighlightConsumed])

  const filteredCards = useMemo(() => {
    return cards.filter((c) => matchesQuery(c, query.trim()))
  }, [cards, query])

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

  // When jumping to a highlighted card, ensure its group is open.
  useEffect(() => {
    if (!highlightCardId) return
    const target = filteredCards.find((c) => c.id === highlightCardId)
    if (!target) return
    const group = groups.find((g) => g.cards.some((c) => c.id === target.id))
    if (group) {
      setOpenGroups((prev) => ({ ...prev, [group.label]: true }))
    }
  }, [highlightCardId, filteredCards, groups])

  function startEdit(card: Card) {
    setEditingId(card.id)
    setDraft({ front: card.front, back: card.back, example: card.example ?? '' })
  }

  async function commitEdit(card: Card) {
    await updateCard(card.id, draft)
    setEditingId(null)
    await refresh()
    onChanged?.()
  }

  async function handleDelete(card: Card) {
    if (!confirm(`确定删除「${card.front}」？相关学习进度也会被清除。`)) return
    await deleteCard(card.id)
    await deleteOneProgress(card.id)
    await refresh()
    onChanged?.()
  }

  async function refresh() {
    setCards(await allCards())
  }

  function enterSelectMode() {
    setSelectMode(true)
    setSelectedIds(new Set())
    setEditingId(null)
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
    <div className="space-y-3">
      <ActivityHeatmap refreshKey={refreshKey} />

      {/* Search box */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词、释义或例句…"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="清除搜索"
          >
            ✕
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {selectMode
            ? `已选 ${selectedIds.size} / ${filteredCards.length}`
            : query.trim()
            ? `匹配 ${filteredCards.length} / ${cards.length} 张`
            : `共 ${cards.length} 张卡片`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {selectMode ? (
            <>
              <button
                onClick={toggleSelectAll}
                disabled={filteredCards.length === 0}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 active:scale-95 disabled:opacity-40"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleExport}
                disabled={selectedIds.size === 0}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 active:scale-95 disabled:opacity-40"
              >
                导出选中（{selectedIds.size}）
              </button>
              <button
                onClick={exitSelectMode}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 active:scale-95"
              >
                退出
              </button>
            </>
          ) : (
            <>
              <button
                onClick={enterSelectMode}
                disabled={filteredCards.length === 0}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 active:scale-95 disabled:opacity-40"
              >
                选择导出
              </button>
              <button
                onClick={handleExport}
                disabled={filteredCards.length === 0}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 active:scale-95 disabled:opacity-40"
              >
                {query.trim() ? '导出筛选结果' : '全部导出'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Empty states */}
      {cards.length === 0 && (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 ring-1 ring-slate-200">
          还没有卡片，先去「添加」页面创建吧
        </p>
      )}
      {cards.length > 0 && filteredCards.length === 0 && (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 ring-1 ring-slate-200">
          没有匹配「{query}」的卡片
        </p>
      )}

      {/* Grouped list */}
      <div className="space-y-3">
        {groups.length > 1 && (
          <div className="flex justify-end gap-2 px-1">
            <button
              onClick={() => setAllOpen(true)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              全部展开
            </button>
            <span className="text-xs text-slate-300">|</span>
            <button
              onClick={() => setAllOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              全部折叠
            </button>
          </div>
        )}
        {groups.map((group) => {
          const open = isOpen(group.label)
          return (
            <section key={group.label} className="space-y-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-slate-100"
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
                <h3 className="text-sm font-semibold text-slate-700">{group.label}</h3>
                <span className="text-xs text-slate-400">{group.cards.length}</span>
              </button>
              {open && (
                <ul className="space-y-2">
                  {group.cards.map((card) => {
                    const isEditing = editingId === card.id
                    const isFlashing = flashId === card.id
                    const isSelected = selectedIds.has(card.id)
                    return (
                      <li
                        key={card.id}
                        ref={(el) => {
                          if (el) cardRefs.current.set(card.id, el)
                          else cardRefs.current.delete(card.id)
                        }}
                        onClick={selectMode && !isEditing ? () => toggleSelected(card.id) : undefined}
                        className={`rounded-2xl bg-white p-4 shadow-sm ring-1 transition-all duration-500 ${
                          isFlashing
                            ? 'ring-2 ring-emerald-400 bg-emerald-50'
                            : isSelected
                            ? 'ring-2 ring-brand-500 bg-brand-50'
                            : 'ring-slate-200'
                        } ${selectMode && !isEditing ? 'cursor-pointer' : ''}`}
                      >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          className="w-full rounded-lg border border-slate-300 px-2 py-1"
                          value={draft.front}
                          onChange={(e) => setDraft({ ...draft, front: e.target.value })}
                          placeholder="正面"
                        />
                        <MarkdownEditor
                          value={draft.back}
                          onChange={(md) => setDraft({ ...draft, back: md })}
                        />
                        <input
                          className="w-full rounded-lg border border-slate-300 px-2 py-1"
                          value={draft.example}
                          onChange={(e) => setDraft({ ...draft, example: e.target.value })}
                          placeholder="例句"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => commitEdit(card)}
                            className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(card.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{card.front}</span>
                            {/^[a-zA-Z]/.test(card.front) && (
                              <SpeakButton text={card.front} lang="en" />
                            )}
                          </div>
                          <Markdown content={card.back} className="mt-0.5 text-slate-600" />
                          {card.example && (
                            <div className="mt-1 flex items-center gap-1">
                              <p className="text-sm italic text-slate-400">{card.example}</p>
                              <SpeakButton text={card.example} lang="en" className="shrink-0" />
                            </div>
                          )}
                        </div>
                        {!selectMode && (
                          <div className="flex shrink-0 flex-col gap-1">
                            <button
                              onClick={() => startEdit(card)}
                              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDelete(card)}
                              className="rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-200"
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
