import { t, useLanguage } from './lib/i18n'
// Match iOS: Cards / Add / Settings, with a separate study session.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibrarySnapshot } from './hooks/useLibrarySnapshot'
import { useSidebarResize } from './hooks/useSidebarResize'
import { StudyDetailsPage, type StudyDetails } from './components/StudyDetailsPage'
import { BrowsePage } from './components/BrowsePage'
import { normalizeStudyScope } from './lib/tags'
import { TagStudyPage } from './components/TagStudyPage'
import type { Card, StudyScope } from './types'
import { StudyPage } from './components/StudyPage'
import { AddPage } from './components/AddPage'
import { CardManager, type CardsSection } from './components/CardManager'
import { SettingsPanel, type SettingsHandle } from './components/SettingsPanel'
import { CloudSyncStatus } from './components/CloudSyncStatus'
import { ImportHelp } from './components/ImportHelp'

import { TaskQueuePage } from './components/TaskQueuePage'
import { generationQueue } from './lib/generationQueue'
import { useGenerationQueue } from './hooks/useGenerationQueue'

type Tab = 'tasks' | 'add' | CardsSection | 'settings' | 'help'

const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: '今日练习' },
  { key: 'history', label: '学习记录' },
  { key: 'library', label: '卡片库' },
  { key: 'add', label: '添加' },
  { key: 'tasks', label: '任务队列' },
  { key: 'settings', label: '设置' },
]

// Only the macOS Tauri window draws its content beneath native window controls.
const hasMacTitlebar = '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.platform)

export default function App() {
  useLanguage()
  const { tasks } = useGenerationQueue()
  const [queueNotice, setQueueNotice] = useState(false)
  useEffect(() => { const submitted = () => setQueueNotice(true); window.addEventListener('vibe-ai-submitted', submitted); return () => window.removeEventListener('vibe-ai-submitted', submitted) }, [])
  const [queueError, setQueueError] = useState('')
  useEffect(() => { const unsubscribe = generationQueue.subscribe(() => { if (!generationQueue.error) setQueueError('') }); void generationQueue.initialize().catch(e => setQueueError(String(e))); return unsubscribe }, [])
  const sidebar = useSidebarResize(hasMacTitlebar)
  const settings = useRef<SettingsHandle>(null)
  const [addOpened, setAddOpened] = useState(false)
  const [tab, setTab] = useState<Tab>('today')
  const [helpReturnTab, setHelpReturnTab] = useState<Tab>('add')
  const [aheadDays,setAheadDays] = useState(0)
  const [sessionDeck, setSessionDeck] = useState<string | null>(null)
  const [sessionVersion,setSessionVersion] = useState(0)
  const [sessionScope, setSessionScope] = useState<StudyScope>(null)
  const [tagStudy, setTagStudy] = useState(false)
  const [tagSelection, setTagSelection] = useState<string[] | null>(null)
  const [sessionOrigin, setSessionOrigin] = useState<'cards' | 'tags'>('cards')
  const [studyDetails,setStudyDetails] = useState<StudyDetails|null>(null)
  const [browse, setBrowse] = useState<{ cards: Card[] } | null>(null)
  const [studying, setStudying] = useState(false)
  const [sessionStarted, setSessionStarted] = useState(false)
  const [canResume, setCanResume] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null)
  const library = useLibrarySnapshot(refreshKey)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(()=>{const reset=()=>{setSessionStarted(false);setStudying(false);setCanResume(false);setTagStudy(false);setTagSelection(null);bump()};window.addEventListener('vibe-library-restored',reset);return()=>window.removeEventListener('vibe-library-restored',reset)},[bump])

  useEffect(() => generationQueue.onCompleted(bump), [bump])

  function switchTab(next: Tab) {
    const leave = () => {
      if (next === 'help' && tab !== 'help') setHelpReturnTab(tab)
      if (next === 'add') setAddOpened(true)
      setTab(next)
    }
    if (tab === 'settings' && next !== tab) settings.current?.requestLeave(leave)
    else leave()
  }

  function startStudy(scope: StudyScope, origin: 'cards' | 'tags') {
    setSessionDeck(null)
    setSessionScope(normalizeStudyScope(scope))
    setSessionOrigin(origin)
    setAheadDays(0)
    setSessionVersion(v => v + 1)
    setCanResume(false)
    setTagStudy(false)
    setSessionStarted(true)
    setStudying(true)
  }

  function jumpToCard(cardId: string) {
    setHighlightCardId(cardId)
    switchTab('library')
  }

  return (
    <div style={sidebar.style} className={`app-page mac-app${hasMacTitlebar ? ' mac-native-window' : ''}`}>
      {hasMacTitlebar && <div className="mac-window-drag-region" data-tauri-drag-region aria-hidden="true" />}
      <aside hidden={studying || tagStudy || browse !== null || studyDetails !== null} className="mac-sidebar">
        <nav aria-label="Vibe Word">
          {TABS.map(item => <button key={item.key} onClick={() => switchTab(item.key)} aria-current={tab === item.key ? 'page' : undefined} className={`mac-nav-item${item.key === 'settings' ? ' mac-sidebar-settings' : item.key === 'tasks' ? ' mac-task-nav' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {item.key === 'today' ? <><path d="M9 5l11 7-11 7z"/></> : item.key === 'history' ? <><path d="M4 19h16M7 15V9M12 15V5M17 15v-4"/></> : item.key === 'library' ? <><rect x="7" y="6" width="13" height="15" rx="2"/><path d="M16 3H5a2 2 0 0 0-2 2v12M11 11h5M11 15h5"/></> : item.key === 'add' ? <><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 7v10M7 12h10"/></> : item.key === 'tasks' ? <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/></> : <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--mac-sidebar)"/><circle cx="15" cy="17" r="3" fill="var(--mac-sidebar)"/></>}
            </svg>
            <span>{t(item.label)}</span>{item.key === 'tasks' && <><small className="task-badge">{tasks.reduce((n, task) => n + task.drafts.filter(d => d.status === 'ready').length, 0) || ''}</small>{tasks.some(task => task.status === 'running') && <span className="task-running" aria-label={t('生成中')}>●</span>}</>}
          </button>)}
        </nav>
        <div {...sidebar.handleProps} className="mac-sidebar-resizer" aria-label={t("调整侧边栏宽度")} />
      </aside>


      {queueNotice && <div role="status" className="ai-submitted-notice">{t('已加入任务队列')}<button onClick={() => { setStudying(false); setQueueNotice(false); switchTab('tasks') }}>{t('查看任务队列')}</button><button aria-label={t('关闭')} onClick={() => setQueueNotice(false)}>×</button></div>}
      {sessionStarted && <div hidden={!studying}>
        <StudyPage deckId={sessionDeck} key={JSON.stringify([sessionDeck,sessionScope,aheadDays,sessionVersion])} scope={sessionScope} exitLabel={sessionOrigin === 'tags' ? '返回标签筛选' : '返回我的卡片'} ahead={aheadDays} active={studying} onSessionChange={setCanResume} onExit={() => { setStudying(false); setTagStudy(sessionOrigin === 'tags'); setTab('today'); bump() }} />
      </div>}
      {studyDetails && <StudyDetailsPage page={studyDetails} onAhead={days=>{setStudyDetails(null);setSessionDeck(null);setAheadDays(days);setSessionScope(null);setSessionOrigin('cards');setSessionVersion(v=>v+1);setSessionStarted(true);setStudying(true)}} onExit={() => setStudyDetails(null)} />}
      {tagStudy && <TagStudyPage value={tagSelection ?? []} onChange={setTagSelection} onStart={scope => startStudy(scope, 'tags')} refreshKey={refreshKey} onExit={() => setTagStudy(false)} />}
      {browse && <BrowsePage cards={browse.cards} onExit={() => setBrowse(null)} />}
      <main hidden={studying || tagStudy || browse !== null || studyDetails !== null} className="mac-main">
        {addOpened && <div hidden={tab !== 'add'}><AddPage onViewTasks={() => switchTab('tasks')} onAdded={bump} onJumpToCard={jumpToCard} onViewCards={() => switchTab('library')} onHelp={() => switchTab('help')} /></div>}
        {(tab === 'today' || tab === 'history' || tab === 'library') && (
            <CardManager
              section={tab}
              history={library.history}
              historyError={library.historyError}
              snapshot={library.snapshot}
              loadError={library.error}
              onDeckStudy={id => { startStudy(null, "cards"); setSessionDeck(id) }}
              onOpenDetails={setStudyDetails}
              refreshKey={refreshKey}
              onChanged={bump}
              canResume={canResume}
              sessionScope={sessionScope}
              onBrowse={(cards) => setBrowse({ cards })}
              onStudy={scope => startStudy(scope, 'cards')}
              onTagStudy={scope => { setTagSelection(previous => previous ?? scope ?? []); setTagStudy(true) }}
              onResume={() => { setTagStudy(false); setStudying(true) }}
              onEditScope={() => { switchTab('settings'); requestAnimationFrame(() => document.getElementById('study-settings')?.scrollIntoView({ block: 'center' })) }}
              highlightCardId={highlightCardId}
              onHighlightConsumed={() => setHighlightCardId(null)}
            />
        )}
        {queueError && <p role="alert" className="status-error">{queueError}</p>}
        {tab === 'tasks' && <TaskQueuePage onChanged={bump} />}
        {tab === 'settings' && <SettingsPanel ref={settings} onChanged={bump} onHelp={() => switchTab('help')} />}
        {tab === 'help' && <ImportHelp onBack={() => switchTab(helpReturnTab)} />}
        <CloudSyncStatus onChange={bump} visible={tab === 'settings'} />
      </main>
    </div>
  )
}
