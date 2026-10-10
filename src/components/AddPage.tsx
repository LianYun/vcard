import { AnkiImport } from './AnkiImport'
import { useState } from 'react'
import { AIGenerateForm } from './AIGenerateForm'
import { AddCardForm } from './AddCardForm'
import { DocumentImport } from './DocumentImport'
import { t } from '../lib/i18n'

export function AddPage({ onAdded, onJumpToCard, onViewCards, onHelp, onViewTasks }: { onAdded: () => void; onJumpToCard: (id: string) => void; onViewCards: () => void; onHelp: () => void; onViewTasks: () => void }) {
  const [mode, setMode] = useState<'card' | 'ai' | 'document' | 'anki'>('card')
  const [opened, setOpened] = useState(false)
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('添加')}>
      <button className={mode === 'card' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('card')}>{t('创建卡片')}</button>
      <button className={mode === 'ai' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('ai')}>{t('AI 生成')}</button>
      <button className={mode === 'document' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setOpened(true); setMode('document') }}>{t('导入文件')}</button>
      <button className={mode === 'anki' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('anki')}>{t('导入 Anki')}</button>
      {mode === 'document' && <button type="button" onClick={onHelp} aria-label={t('帮助与导入格式')} title={t('帮助与导入格式')} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.8-2.5 3.5" /><path d="M12 16.5h.01" /></svg>
      </button>}
    </div>
    <div hidden={mode !== 'card'}><AddCardForm onAdded={onAdded} /></div>
    <div hidden={mode !== 'ai'}><AIGenerateForm onViewTasks={onViewTasks} onAdded={onAdded} onJumpToCard={onJumpToCard} /></div>
    {mode === 'anki' && <AnkiImport onChanged={onAdded} />}
    {opened && <div hidden={mode !== 'document'} className="space-y-5">
      <DocumentImport onViewTasks={onViewTasks} onAdded={onAdded} onViewCards={onViewCards} /></div>}
  </div>
}
