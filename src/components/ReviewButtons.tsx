// Self-grading buttons shown after the card is flipped. Each button maps to an
// SM-2 quality value (see sm2.ts). The interval hint is approximate and purely
// cosmetic — the real interval depends on the card's own scheduling state.

import type { ReviewButton } from '../types'

interface Props {
  onReview: (button: ReviewButton) => void
  disabled?: boolean
}

interface ButtonDef {
  key: ReviewButton
  label: string
  hint: string
  shortcut: string
  classes: string
}

export const BUTTON_SHORTCUTS: Record<string, ReviewButton> = {
  a: 'again',
  s: 'hard',
  d: 'good',
  e: 'easy',
}

const BUTTONS: ButtonDef[] = [
  { key: 'again', label: '重来', hint: '<1分钟', shortcut: 'A', classes: 'bg-rose-500 hover:bg-rose-600' },
  { key: 'hard', label: '困难', hint: '~10分钟', shortcut: 'S', classes: 'bg-orange-500 hover:bg-orange-600' },
  { key: 'good', label: '良好', hint: '明天', shortcut: 'D', classes: 'bg-sky-500 hover:bg-sky-600' },
  { key: 'easy', label: '简单', hint: '后天+', shortcut: 'E', classes: 'bg-emerald-500 hover:bg-emerald-600' },
]

export function ReviewButtons({ onReview, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          type="button"
          disabled={disabled}
          onClick={() => onReview(b.key)}
          className={`flex flex-col items-center rounded-2xl px-4 py-3 font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-40 ${b.classes}`}
        >
          <span className="text-base">
            {b.label}
            <kbd className="ml-1.5 rounded bg-white/25 px-1.5 py-0.5 text-xs font-normal">{b.shortcut}</kbd>
          </span>
          <span className="text-xs font-normal opacity-90">{b.hint}</span>
        </button>
      ))}
    </div>
  )
}
