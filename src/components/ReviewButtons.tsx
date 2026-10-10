import { DEFAULT_SHORTCUTS, shortcutLabel, type Shortcuts } from '../lib/shortcuts'
import { t } from '../lib/i18n'
import type { ReviewButton } from '../types'

interface Props {
  onReview: (button: ReviewButton) => void
  disabled?: boolean
  shortcuts?: Shortcuts
  previews?: Record<string,string>
}
const BUTTONS: { key: ReviewButton; label: string; hint: string; symbol: string }[] = [
  { key: 'again', label: "重来", hint: "还没记住", symbol: '↶' },
  { key: 'hard', label: "困难", hint: "费力想起", symbol: '···' },
  { key: 'good', label: "良好", hint: "顺利想起", symbol: '✓' },
  { key: 'easy', label: "简单", hint: "非常熟悉", symbol: '◎' },
]
export function ReviewButtons({ onReview, disabled, previews, shortcuts = DEFAULT_SHORTCUTS }: Props) {
  return <div className="study-grades">
    {BUTTONS.map((button) => <button key={button.key} type="button" disabled={disabled}
      onClick={() => onReview(button.key)} className={`study-grade ${button.key}`}>
      <span className="study-grade-label"><span><span aria-hidden="true" className="study-grade-symbol">{button.symbol}</span>{t(button.label)}</span>{shortcuts[button.key] && <kbd>{t(shortcutLabel(shortcuts[button.key]))}</kbd>}</span>
      <small>{previews?.[button.key] ?? t(button.hint)}</small>
    </button>)}
  </div>
}
