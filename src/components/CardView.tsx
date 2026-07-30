import type { Card } from '../types'
import { Markdown } from './Markdown'
import { SpeakButton } from './SpeakButton'

interface Props {
  card: Card
  flipped: boolean
  onFlipChange: (flipped: boolean) => void
}

export function CardView({ card, flipped, onFlipChange }: Props) {
  function toggle(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-no-flip]')) return
    onFlipChange(!flipped)
  }

  const frontIsEnglish = /^[a-zA-Z]/.test(card.front)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      className="app-surface group relative flex min-h-[18rem] w-full cursor-pointer select-none flex-col items-center justify-center px-6 py-10 text-center transition hover:border-slate-300 sm:px-8"
      aria-label="点击翻面"
    >
      <div className="absolute left-5 top-4 text-xs font-semibold text-slate-400">
        {flipped ? '释义' : '单词'}
      </div>

      <div className="absolute right-4 top-3" data-no-flip>
        {!flipped ? (
          <SpeakButton
            text={card.front}
            lang={frontIsEnglish ? 'en' : 'zh'}
          />
        ) : (
          <SpeakButton
            text={frontIsEnglish ? card.front : card.back}
            lang="en"
          />
        )}
      </div>

      {!flipped ? (
        <div className="max-w-full space-y-3">
          <Markdown content={card.front} className="break-words text-3xl font-bold text-slate-900 sm:text-4xl" />
          <p className="text-sm text-slate-400">空格 / 点击查看释义</p>
        </div>
      ) : (
        <div className="w-full space-y-4">
          <h3 className="break-words text-2xl font-semibold text-brand-700">{card.front}</h3>
          <Markdown content={card.back} className="text-left text-base leading-7 text-slate-700" />
          {card.example && (
            <div className="app-surface-muted mt-3 flex max-w-prose items-center gap-2 px-3 py-2 text-left" data-no-flip>
              <p className="text-sm italic leading-6 text-slate-500">
                {card.example}
              </p>
              <SpeakButton text={card.example} lang="en" className="shrink-0" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
