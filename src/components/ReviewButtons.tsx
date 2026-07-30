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
  kbd: string
}

export const BUTTON_SHORTCUTS: Record<string, ReviewButton> = {
  a: 'again',
  s: 'hard',
  d: 'good',
  e: 'easy',
}

const BUTTONS: ButtonDef[] = [
  { key: 'again', label: '重来', hint: '<1分钟', shortcut: 'A', classes: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100', kbd: 'border-rose-200 bg-white text-rose-600' },
  { key: 'hard', label: '困难', hint: '~10分钟', shortcut: 'S', classes: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100', kbd: 'border-amber-200 bg-white text-amber-700' },
  { key: 'good', label: '良好', hint: '明天', shortcut: 'D', classes: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100', kbd: 'border-sky-200 bg-white text-sky-600' },
  { key: 'easy', label: '简单', hint: '后天+', shortcut: 'E', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100', kbd: 'border-emerald-200 bg-white text-emerald-600' },
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
          className={`flex min-h-20 flex-col items-center justify-center rounded-2xl border px-4 py-3 font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${b.classes}`}
        >
          <span className="text-base">
            {b.label}
            <kbd className={`ml-1.5 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${b.kbd}`}>{b.shortcut}</kbd>
          </span>
          <span className="text-xs font-medium opacity-80">{b.hint}</span>
        </button>
      ))}
    </div>
  )
}
