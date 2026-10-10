import { t } from '../lib/i18n'
import { useCallback } from 'react'
import { speak, isSupported } from '../lib/tts'

interface Props {
  text: string
  lang?: 'en' | 'zh'
  className?: string
}

export function SpeakButton({ text, lang = 'en', className = '' }: Props) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      speak(text, lang)
    },
    [text, lang],
  )

  if (!isSupported()) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center justify-center rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 active:scale-90 ${className}`}
      aria-label={t("朗读: {0}", text.slice(0, 20))}
      title={t("朗读")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    </button>
  )
}
