import { useEffect, useState } from 'react'
import type { Card } from '../types'
import { Markdown } from './Markdown'
import { SpeakButton } from './SpeakButton'

interface Props {
  card: Card
  onFlipChange?: (flipped: boolean) => void
}

export function CardView({ card, onFlipChange }: Props) {
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    setFlipped(false)
    onFlipChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  function toggle(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-no-flip]')) return
    setFlipped((f) => {
      const next = !f
      onFlipChange?.(next)
      return next
    })
  }

  const frontIsEnglish = /^[a-zA-Z]/.test(card.front)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(e as unknown as React.MouseEvent) } }}
      className="group relative w-full cursor-pointer select-none rounded-3xl bg-white shadow-xl ring-1 ring-slate-200 transition-all hover:shadow-2xl min-h-[18rem] flex flex-col items-center justify-center px-8 py-10 text-center"
      aria-label="点击翻面"
    >
      <div className="absolute top-4 left-5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {flipped ? '释义' : '单词'}
        {card.custom && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
            自建
          </span>
        )}
      </div>

      <div className="absolute top-3 right-4" data-no-flip>
        {!flipped ? (
          <SpeakButton
            text={card.front}
            lang={frontIsEnglish ? 'en' : 'zh'}
          />
        ) : (
          card.example ? (
            <SpeakButton text={card.example} lang="en" />
          ) : (
            <SpeakButton
              text={frontIsEnglish ? card.front : card.back}
              lang="en"
            />
          )
        )}
      </div>

      {!flipped ? (
        <div className="space-y-2">
          <Markdown content={card.front} className="text-3xl font-bold tracking-wide text-slate-800 sm:text-4xl" />
          <p className="text-sm text-slate-400">点击查看释义</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <h3 className="text-2xl font-semibold text-brand-600">{card.front}</h3>
          <Markdown content={card.back} className="text-left text-base text-slate-700" />
          {card.example && (
            <p className="mt-3 max-w-prose text-sm italic text-slate-500">
              {card.example}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
