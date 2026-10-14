import { WorkspaceToolbar, WorkspaceBreadcrumb } from './WorkspaceToolbar'
import type { Card } from '../types'
import { useLibraryTags } from '../hooks/useLibraryTags'
import { normalizeTags } from '../lib/tags'
import { CardOrganization } from './CardOrganization'
import { AnkiImport } from './AnkiImport'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AIGenerateForm } from './AIGenerateForm'
import { AddCardForm } from './AddCardForm'
import { DocumentImport } from './DocumentImport'
import { t } from '../lib/i18n'
import './AddPage.css'

const modes = [
  { id: 'card', label: '创建卡片' },
  { id: 'ai', label: 'AI 生成' },
  { id: 'document', label: '导入文件' },
  { id: 'anki', label: '导入 Anki' },
] as const
type AddMode = typeof modes[number]['id']

export function AddPage({ initialDeckId = 'default', requestKey, onAdded, onJumpToCard, onViewCards, onHelp, onViewTasks, cards, onManage }: { cards: Card[]; onManage: (view: 'decks' | 'tags') => void; initialDeckId?: string; requestKey?: number; onAdded: () => void; onJumpToCard: (id: string) => void; onViewCards: () => void; onHelp: () => void; onViewTasks: () => void }) {
  const [tags, setTags] = useState<string[]>([])
  const { tags: libraryTags } = useLibraryTags(cards.flatMap(card => normalizeTags(card.tags)))
  const availableTags = libraryTags.filter(tag => !tags.includes(tag))
  const [deckId, setDeckId] = useState(initialDeckId)
  useEffect(() => setDeckId(initialDeckId), [initialDeckId, requestKey])
  const [mode, setMode] = useState<AddMode>('card')
  const [opened, setOpened] = useState<Partial<Record<AddMode, boolean>>>({ card: true, ai: true })
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  function selectMode(next: AddMode) {
    setOpened(previous => ({ ...previous, [next]: true }))
    setMode(next)
  }
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % modes.length; break
      case 'ArrowLeft': next = (index + modes.length - 1) % modes.length; break
      case 'Home': next = 0; break
      case 'End': next = modes.length - 1; break
      default: return
    }
    event.preventDefault()
    selectMode(modes[next].id)
    tabs.current[next]?.focus({ preventScroll: true })
    tabs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <div className="add-workspace space-y-4">
    <WorkspaceBreadcrumb page="add"><nav aria-label={t('当前位置')}><span>{t('内容')}</span><span aria-hidden="true">/</span><span>{t('添加')}</span><span aria-hidden="true">/</span><span aria-current="page">{t(modes.find(item => item.id === mode)!.label)}</span></nav></WorkspaceBreadcrumb>
    <WorkspaceToolbar page="add"><div className="add-tabs" role="tablist" aria-label={t('添加')}>
      {modes.map((item, index) => <button key={item.id} type="button" role="tab"
        ref={element => { tabs.current[index] = element }}
        id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`}
        aria-selected={mode === item.id} tabIndex={mode === item.id ? 0 : -1}
        className="add-tab" onClick={() => selectMode(item.id)}
        onKeyDown={event => onTabKeyDown(event, index)}>{t(item.label)}</button>)}
    </div>
    </WorkspaceToolbar>
    {mode !== 'card' && mode !== 'anki' && <CardOrganization deckId={deckId} onDeckChange={setDeckId} tags={tags} onTagsChange={setTags} availableTags={availableTags} onManage={onManage} />}
    {modes.map(item => <div key={item.id} role="tabpanel" id={`${id}-panel-${item.id}`}
      aria-labelledby={`${id}-tab-${item.id}`} hidden={mode !== item.id} className="add-panel" tabIndex={0}>
      {opened[item.id] && <>
        {item.id === 'card' && <AddCardForm cards={cards} onManage={onManage} initialTags={tags} initialDeckId={deckId} onAdded={onAdded} />}
        {item.id === 'ai' && <AIGenerateForm targetTags={tags} targetDeckId={deckId} onViewTasks={onViewTasks} onAdded={onAdded} onJumpToCard={onJumpToCard} />}
        {item.id === 'anki' && <AnkiImport initialDeckId={initialDeckId === 'default' ? '' : initialDeckId} onChanged={onAdded} />}
        {item.id === 'document' && <>
          <div className="add-help-row"><button type="button" onClick={onHelp} className="add-help">{t('帮助与导入格式')} <span aria-hidden="true">↗</span></button></div>
          <DocumentImport targetTags={tags} targetDeckId={deckId} onViewTasks={onViewTasks} onAdded={onAdded} onViewCards={onViewCards} />
        </>}
      </>}
    </div>)}
  </div>
}
