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
    return <p className="text-center text-slate-500">准备中…</p>
  }

  if (queue.finished) {
    return (
      <div className="space-y-5 text-center">
        <h2 className="text-2xl font-bold text-slate-800">🎉 今日学习完成！</h2>
        <p className="text-slate-500">
          共完成 {queue.done} 张，其中重学 {queue.relearned} 次。明天见。
        </p>
        <button
          onClick={() => queue.reset()}
          className="rounded-xl bg-slate-200 px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-300"
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
        <p className="text-center text-sm text-slate-400">
          按 <kbd className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">Space</kbd> 或点击卡片查看释义
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
