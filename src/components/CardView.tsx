import { memo } from 'react'
import { AnkiNoteEditor } from './AnkiNoteEditor'
import { t, useLanguage } from '../lib/i18n'
import type { Card } from '../types'
import { Markdown } from './Markdown'
import { SpeakButton } from './SpeakButton'

const markdownLayout = 'min-w-0 break-words [overflow-wrap:anywhere] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto'

// Both reading modes use the same content, typography, and speech controls.
export const CardFace = memo(function CardFace({ card, back = false, editable = true }: { card: Card; back?: boolean; editable?: boolean }) {
  useLanguage()
  const english = /^[a-zA-Z]/.test(card.front)
  const content = back ? card.back : card.front
  const short = content.trim().length <= (back ? 80 : 48) && !content.includes('\n')
  return <section className={`card-face ${back ? 'card-face-back' : 'card-face-front'}`} aria-label={back ? t('背面 · 答案') : t('正面 · 题目')}>
    <header className="card-face-heading">
<span className="card-side-indicator" aria-hidden="true" />
      <SpeakButton text={back && english ? card.front : content} lang={back || english ? 'en' : 'zh'} />
    </header>
    <div className={`card-face-body${short && !back ? ' card-face-short' : ''}`}>
      <Markdown content={content} className={`${markdownLayout} ${short
        ? 'text-2xl font-semibold leading-relaxed tracking-tight sm:text-3xl'
        : 'text-base leading-8 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base'}`} />
      {editable && back && card.anki && <AnkiNoteEditor card={card} />}
      {back && card.example && <div className="card-example">
        <div className="card-face-heading"><p>{t('放进句子里记')}</p><SpeakButton text={card.example} lang="en" /></div>
        <p className="whitespace-pre-line break-words text-sm leading-7 [overflow-wrap:anywhere]">{card.example}</p>
      </div>}
    </div>
  </section>
})

interface Props {
  card: Card
  flipped: boolean
  onFlipChange: (flipped: boolean) => void
  disabled?: boolean
}

export function CardView({ card, flipped, onFlipChange, disabled }: Props) {
  return <article className={`app-surface study-card study-flip-card ${flipped ? 'is-back' : 'is-front'}`} tabIndex={disabled ? -1 : 0} aria-label={flipped ? t('背面 · 答案') : t('正面 · 题目')}
    onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter' && !event.repeat && !disabled) { event.preventDefault(); onFlipChange(!flipped) } }} onClick={(event) => {
    if (disabled || (event.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable], audio, video') || window.getSelection()?.toString()) return
    onFlipChange(!flipped)
  }}>
    <div className="study-visible-face"><CardFace card={card} back={flipped} /></div>

  </article>
}
