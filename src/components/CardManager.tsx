import { useEffect, useState } from 'react'
import { deleteCard, updateCard, allCards } from '../lib/cardStore'
import { cardsToObsidianMd, downloadMarkdown } from '../lib/export'
import { deleteOneProgress } from '../lib/storage'
import type { Card } from '../types'
import { Markdown } from './Markdown'
import { MarkdownEditor } from './MarkdownEditor'
import { SpeakButton } from './SpeakButton'

interface Props {
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
    allCards().then(setCards)
  }, [refreshKey])

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

  async function handleExport() {
    const all = await allCards()
    if (all.length === 0) return
    const md = cardsToObsidianMd(all)
    const date = new Date().toISOString().slice(0, 10)
    downloadMarkdown(md, `vibe-word-${date}.md`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          共 {cards.length} 张卡片
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
                    </div>
                    <Markdown content={card.back} className="mt-0.5 text-slate-600" />
                    {card.example && (
                      <Markdown content={`*${card.example}*`} className="mt-1 text-sm text-slate-400" />
                    )}
                  </div>
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
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
