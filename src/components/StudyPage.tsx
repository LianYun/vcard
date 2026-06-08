// The main study page. Drives a review session via useReviewQueue.

import { useReviewQueue } from '../hooks/useReviewQueue'
import { CardView } from './CardView'
import { ReviewButtons } from './ReviewButtons'
import { ProgressBar } from './ProgressBar'
import { useState } from 'react'

export function StudyPage() {
  const queue = useReviewQueue()
  const [flipped, setFlipped] = useState(false)

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

      <CardView key={card.id} card={card} onFlipChange={setFlipped} />

      {!flipped ? (
        <p className="text-center text-sm text-slate-400">
          先在脑海中回忆，然后点击卡片查看释义
        </p>
      ) : (
        <ReviewButtons onReview={(b) => { queue.review(b); setFlipped(false) }} />
      )}
    </div>
  )
}
