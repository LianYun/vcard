// The main study page. Drives a review session via useReviewQueue.

import { useEffect, useState } from 'react'
import { useReviewQueue } from '../hooks/useReviewQueue'
import { CardView } from './CardView'
import { ReviewButtons, BUTTON_SHORTCUTS } from './ReviewButtons'
import { ProgressBar } from './ProgressBar'

export function StudyPage() {
  const queue = useReviewQueue()
  const [flipped, setFlipped] = useState(false)

  const currentId = queue.current?.id

  // Reset to front whenever the visible card changes.
  useEffect(() => {
    setFlipped(false)
  }, [currentId])

  // Keyboard shortcuts: space to flip, A/S/D/E to grade.
  useEffect(() => {
    if (!queue.ready || queue.finished) return

    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs/textareas/contenteditable.
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === ' ') {
        e.preventDefault()
        setFlipped((f) => !f)
        return
      }

      if (flipped) {
        const grade = BUTTON_SHORTCUTS[e.key.toLowerCase()]
        if (grade) {
          e.preventDefault()
          queue.review(grade)
          setFlipped(false)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queue, flipped])

  if (!queue.ready) {
    return (
      <div className="app-surface-muted p-8 text-center">
        <p className="section-copy">准备中…</p>
      </div>
    )
  }

  if (queue.finished) {
    return (
      <div className="app-surface space-y-5 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl font-bold text-emerald-700">
          ✓
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900">今日学习完成</h2>
          <p className="section-copy">
          共完成 {queue.done} 张，其中重学 {queue.relearned} 次。明天见。
          </p>
        </div>
        <button
          onClick={() => queue.reset()}
          className="btn-secondary"
        >
          重新检查
        </button>
      </div>
    )
  }

  const card = queue.current!

  return (
    <div className="space-y-5">
      <ProgressBar done={queue.done} total={queue.total} />

      <CardView card={card} flipped={flipped} onFlipChange={setFlipped} />

      {!flipped ? (
        <p className="text-center text-sm text-slate-500">
          按 <kbd className="kbd-token">Space</kbd> 或点击卡片查看释义
        </p>
      ) : (
        <ReviewButtons
          onReview={(b) => {
            queue.review(b)
            setFlipped(false)
          }}
        />
      )}
    </div>
  )
}
