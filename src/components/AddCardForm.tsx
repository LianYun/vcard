import { useEffect, useState } from 'react'
import { addCard } from '../lib/cardStore'
import { generationQueue } from '../lib/generationQueue'
import { ensureProgressSync, loadLLMConfig, loadProgress, saveOneProgress } from '../lib/storage'
import type { Card, LLMConfig } from '../types'
import { GenerationTaskList } from './GenerationTaskList'
import { MarkdownEditor } from './MarkdownEditor'

interface Props {
  onAdded?: (card: Card) => void
  onJumpToCard?: (cardId: string) => void
}

export function AddCardForm({ onAdded, onJumpToCard }: Props) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [example, setExample] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const [enqueued, setEnqueued] = useState<string | null>(null)

  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null)

  useEffect(() => {
    loadLLMConfig().then(setLlmConfig)
  }, [])

  // Refresh parent (StatsBar / CardManager) whenever a background task completes.
  useEffect(() => {
    return generationQueue.onCompleted(() => {
      onAdded?.({ id: '', front: '', back: '' })
    })
  }, [onAdded])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const card = await addCard(front, back, example)
      const progress = ensureProgressSync(await loadProgress(), card.id)
      await saveOneProgress(progress[card.id])
      setLastAdded(card.front)
      setFront('')
      setBack('')
      setExample('')
      onAdded?.(card)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    }
  }

  function handleGenerate() {
    const word = front.trim()
    if (!word) {
      setError('请先输入一个英文单词')
      return
    }
    if (!llmConfig) {
      setError('请先在设置页配置 AI 模型 API')
      return
    }
    setError(null)
    generationQueue.enqueue(word, llmConfig)
    setEnqueued(word)
    setFront('')
    setBack('')
    setExample('')
    setTimeout(() => setEnqueued((cur) => (cur === word ? null : cur)), 2500)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-md ring-1 ring-slate-200">
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            单词 / 正面 <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="例如：serendipity"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              autoFocus
            />
            {llmConfig && (
              <button
                type="button"
                disabled={!front.trim()}
                onClick={handleGenerate}
                className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-violet-700 active:scale-95 disabled:opacity-40"
              >
                AI 生成（后台）
              </button>
            )}
          </div>
          {!llmConfig && (
            <p className="mt-1 text-xs text-slate-400">
              在设置页配置 AI 模型后，可一键生成释义、词源、例句等
            </p>
          )}
          {enqueued && (
            <p className="mt-2 text-xs text-emerald-600">
              已加入后台队列：「{enqueued}」，可继续提交下一个
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              释义 / 背面
            </label>
            <MarkdownEditor value={back} onChange={setBack} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">例句（可选）</label>
            <input
              type="text"
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="例如：Finding this café was pure serendipity."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <button
            type="submit"
            className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-md transition hover:bg-brand-700 active:scale-95"
          >
            手动添加
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {lastAdded && !error && (
          <p className="mt-3 text-sm text-emerald-600">已添加：「{lastAdded}」</p>
        )}
      </div>

      <GenerationTaskList onJumpToCard={onJumpToCard} />
    </div>
  )
}
