// List + manage all cards. Custom cards can be edited inline or deleted;
// built-in cards are shown read-only. Deleting also clears the card's progress
// so its id never resurfaces in scheduling.

import { useEffect, useState } from 'react'
import { customCards, deleteCard, updateCard, allCards } from '../lib/cardStore'
import { cardsToObsidianMd, downloadMarkdown } from '../lib/export'
import { loadProgress, saveProgress } from '../lib/storage'
import type { Card } from '../types'
import { Markdown } from './Markdown'
import { MarkdownEditor } from './MarkdownEditor'
import { SpeakButton } from './SpeakButton'

interface Props {
  /** Bump this prop to force a refresh from elsewhere (e.g. after adding). */
  refreshKey: number
  onChanged?: () => void
}

export function CardManager({ refreshKey, onChanged }: Props) {
  const [cards, setCards] = useState<Card[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ front: string; back: string; example: string }>({
    front: '',
    back: '',
    example: '',
  })

  useEffect(() => {
    setCards(allCards())
  }, [refreshKey])

  function startEdit(card: Card) {
    setEditingId(card.id)
    setDraft({ front: card.front, back: card.back, example: card.example ?? '' })
  }

  function commitEdit(card: Card) {
    updateCard(card.id, draft)
    setEditingId(null)
    refresh()
    onChanged?.()
  }

  function handleDelete(card: Card) {
    if (!confirm(`确定删除「${card.front}」？相关学习进度也会被清除。`)) return
    deleteCard(card.id)
    // Clear its progress so it doesn't linger in scheduling state.
    const progress = loadProgress()
    if (progress[card.id]) {
      delete progress[card.id]
      saveProgress(progress)
    }
    refresh()
    onChanged?.()
  }

  function refresh() {
    setCards(allCards())
  }

  function handleExport() {
    const all = allCards()
    if (all.length === 0) return
    const md = cardsToObsidianMd(all)
    const date = new Date().toISOString().slice(0, 10)
    downloadMarkdown(md, `vibe-word-${date}.md`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          共 {cards.length} 张卡片（其中 {customCards().length} 张自建）
        </p>
        <button
          onClick={handleExport}
          disabled={cards.length === 0}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 active:scale-95 disabled:opacity-40"
        >
          导出 Obsidian MD
        </button>
      </div>
      <ul className="space-y-2">
        {cards.map((card) => {
          const isEditing = editingId === card.id
          return (
            <li
              key={card.id}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{card.front}</span>
                      {/^[a-zA-Z]/.test(card.front) && (
                        <SpeakButton text={card.front} lang="en" />
                      )}
                      {card.custom ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          自建
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          内置
                        </span>
                      )}
                    </div>
                    <Markdown content={card.back} className="mt-0.5 text-slate-600" />
                    {card.example && (
                      <Markdown content={`*${card.example}*`} className="mt-1 text-sm text-slate-400" />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {card.custom && (
                      <button
                        onClick={() => startEdit(card)}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      >
                        编辑
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(card)}
                      className="rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-200"
                    >
                      删除
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
