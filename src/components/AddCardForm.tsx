import { useEffect, useRef, useState } from 'react'
import { addCard } from '../lib/cardStore'
import { generateCards } from '../lib/llm'
import type { GeneratedCards } from '../lib/llm'
import { ensureProgress, loadLLMConfig, loadProgress, saveProgress } from '../lib/storage'
import type { Card } from '../types'
import { Markdown } from './Markdown'
import { MarkdownEditor } from './MarkdownEditor'

interface Props {
  onAdded?: (card: Card) => void
}

export function AddCardForm({ onAdded }: Props) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [example, setExample] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastAdded, setLastAdded] = useState<string | null>(null)

  // AI generation state
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<GeneratedCards | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (generating) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [generating])

  const llmConfig = loadLLMConfig()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const card = addCard(front, back, example)
      const progress = ensureProgress(loadProgress(), card.id)
      saveProgress(progress)
      setLastAdded(card.front)
      setFront('')
      setBack('')
      setExample('')
      setPreview(null)
      onAdded?.(card)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    }
  }

  async function handleGenerate() {
    if (!front.trim()) {
      setError('请先输入一个英文单词')
      return
    }
    if (!llmConfig) {
      setError('请先在设置页配置 AI 模型 API')
      return
    }
    setError(null)
    setPreview(null)
    setGenerating(true)
    try {
      const result = await generateCards(front.trim(), llmConfig)
      setPreview(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  function handleConfirmAI() {
    if (!preview) return
    setError(null)
    try {
      const card1 = addCard(preview.enToCn.front, preview.enToCn.back, preview.enToCn.example)
      const card2 = addCard(preview.cnToEn.front, preview.cnToEn.back, preview.cnToEn.example)

      let progress = loadProgress()
      progress = ensureProgress(progress, card1.id)
      progress = ensureProgress(progress, card2.id)
      saveProgress(progress)

      setLastAdded(`${card1.front} (×2)`)
      setFront('')
      setPreview(null)
      onAdded?.(card1)
      onAdded?.(card2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-md ring-1 ring-slate-200">
        {/* Word input + AI generate button */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            单词 / 正面 <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={front}
              onChange={(e) => { setFront(e.target.value); setPreview(null) }}
              placeholder="例如：serendipity"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              autoFocus
            />
            {llmConfig && (
              <button
                type="button"
                disabled={generating || !front.trim()}
                onClick={handleGenerate}
                className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-violet-700 active:scale-95 disabled:opacity-40"
              >
                {generating ? `生成中… ${elapsed}s` : 'AI 生成'}
              </button>
            )}
          </div>
          {!llmConfig && (
            <p className="mt-1 text-xs text-slate-400">
              在设置页配置 AI 模型后，可一键生成释义、词源、例句等
            </p>
          )}
        </div>

        {/* AI preview */}
        {preview && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">AI 生成预览（共 2 张卡片）</h4>

            <PreviewCard
              label="卡片 1：英 → 中"
              front={preview.enToCn.front}
              back={preview.enToCn.back}
            />
            <PreviewCard
              label="卡片 2：中 → 英"
              front={preview.cnToEn.front}
              back={preview.cnToEn.back}
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirmAI}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white shadow-md transition hover:bg-emerald-700 active:scale-95"
              >
                确认添加
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-xl bg-slate-200 px-5 py-2.5 font-medium text-slate-700 transition hover:bg-slate-300 active:scale-95"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Manual entry (shown when no preview) */}
        {!preview && (
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
        )}

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {lastAdded && !error && (
          <p className="mt-3 text-sm text-emerald-600">已添加：「{lastAdded}」</p>
        )}
      </div>
    </div>
  )
}

function PreviewCard({ label, front, back }: { label: string; front: string; back: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mb-2">
        <span className="text-xs text-slate-400">正面：</span>
        <Markdown content={front} className="inline font-medium text-slate-800" />
      </div>
      <div>
        <span className="text-xs text-slate-400">背面：</span>
        <Markdown content={back} className="text-slate-700" />
      </div>
    </div>
  )
}
