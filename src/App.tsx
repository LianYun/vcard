import { WorkspaceBrand, WorkspaceNavigation, WORKSPACE_PAGES, PanelIcon, type WorkspacePage } from './components/WorkspaceNavigation'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { WorkspaceToolbarContext } from './components/WorkspaceToolbar'
import { deckPath } from './lib/decks'
import { t, useLanguage } from './lib/i18n'
// Match iOS: Cards / Add / Settings, with a separate study session.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibrarySnapshot } from './hooks/useLibrarySnapshot'
import { useSidebarResize } from './hooks/useSidebarResize'
import { StudyDetailsPage, type StudyDetails } from './components/StudyDetailsPage'
import { BrowsePage } from './components/BrowsePage'
import { normalizeStudyScope } from './lib/tags'
import { DeckStudyPage } from './components/TagStudyPage'
import { TagStudyPage } from './components/TagStudyPage'
import type { Card, StudyScope } from './types'
import { StudyPage } from './components/StudyPage'
import { AddPage } from './components/AddPage'
import { CardManager } from './components/CardManager'
import { SettingsPanel, type SettingsHandle } from './components/SettingsPanel'
import { CloudSyncStatus } from './components/CloudSyncStatus'
import { ImportHelp } from './components/ImportHelp'

import { TaskQueuePage } from './components/TaskQueuePage'
import { generationQueue } from './lib/generationQueue'
import { useGenerationQueue } from './hooks/useGenerationQueue'

type Tab = WorkspacePage

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
  const layout = useWorkspaceLayout()
  const settings = useRef<SettingsHandle>(null)
  const [managementRequest, setManagementRequest] = useState<{ view: 'decks' | 'tags'; revision: number } | null>(null)
  const [addDeck, setAddDeck] = useState('default')
  const [addRequest, setAddRequest] = useState(0)
  const [addOpened, setAddOpened] = useState(false)
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<HTMLElement | null>(null)
  const [statusTarget, setStatusTarget] = useState<HTMLElement | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const main = useRef<HTMLElement>(null)
  useEffect(() => { main.current?.scrollTo({ top: 0 }) }, [tab])
  const [helpReturnTab, setHelpReturnTab] = useState<Tab>('add')
  const [aheadDays,setAheadDays] = useState(0)
  const [deckReturn, setDeckReturn] = useState<{ id: string; revision: number } | null>(null)
  const [sessionDeck, setSessionDeck] = useState<string | null>(null)
  const [sessionVersion,setSessionVersion] = useState(0)
  const [sessionScope, setSessionScope] = useState<StudyScope>(null)
  const [deckStudy, setDeckStudy] = useState(false)
  const [deckSelection, setDeckSelection] = useState('default')
  const [tagStudy, setTagStudy] = useState(false)
  const [tagSelection, setTagSelection] = useState<string[] | null>(null)
  const [sessionOrigin, setSessionOrigin] = useState<'cards' | 'tags' | 'decks' | 'library'>('cards')
  const [studyDetails,setStudyDetails] = useState<StudyDetails|null>(null)
  const [browse, setBrowse] = useState<{ cards: Card[]; focused?: boolean } | null>(null)
  const [studying, setStudying] = useState(false)
  const [sessionStarted, setSessionStarted] = useState(false)
  const [canResume, setCanResume] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null)
  const library = useLibrarySnapshot(refreshKey, tab !== 'tasks')
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(()=>{const reset=()=>{setDeckStudy(false);setSessionStarted(false);setStudying(false);setCanResume(false);setTagStudy(false);setTagSelection(null);bump()};window.addEventListener('vibe-library-restored',reset);return()=>window.removeEventListener('vibe-library-restored',reset)},[bump])

  useEffect(() => generationQueue.onCompleted(bump), [bump])

  function switchTab(next: Tab) {
    const leave = () => {
      if (next === 'help' && tab !== 'help') setHelpReturnTab(tab)
      if (next === 'add') { setAddOpened(true); setAddDeck('default'); setAddRequest(v => v + 1) }
      setTab(next)
      layout.closeDrawer()
    }
    if (tab === 'settings' && next !== tab) settings.current?.requestLeave(leave)
    else leave()
  }

  function startStudy(scope: StudyScope, origin: 'cards' | 'tags' | 'decks' | 'library') {
    setSessionDeck(null)
    setSessionScope(normalizeStudyScope(scope))
    setSessionOrigin(origin)
    setAheadDays(0)
    setSessionVersion(v => v + 1)
    setCanResume(false)
    setTagStudy(false)
    setDeckStudy(false)
    setSessionStarted(true)
    setStudying(true)
  }

  function jumpToCard(cardId: string) {
    setHighlightCardId(cardId)
    switchTab('library')
  }

  const focused = studying || tagStudy || deckStudy || browse !== null || studyDetails !== null
  const currentPage = WORKSPACE_PAGES.find(item => item.key === tab)
  const navigation = { page: tab, onNavigate: switchTab, ready: tasks.reduce((n, task) => n + task.drafts.filter(d => d.status === 'ready').length, 0), running: tasks.some(task => task.status === 'running') }

  return (
    <div style={sidebar.style} className={`app-page mac-app workspace-shell${layout.compact ? ' workspace-compact' : ''}${layout.drawer ? ' workspace-drawer-open' : ''}${tab === 'tasks' && !studying && !tagStudy && !deckStudy && !browse && !studyDetails ? ' mac-task-workspace' : ''}${hasMacTitlebar ? ' mac-native-window' : ''}${studying || tagStudy || deckStudy || browse || studyDetails ? ' workspace-focus' : ''}`}>
      {hasMacTitlebar && <div className="mac-window-drag-region" data-tauri-drag-region aria-hidden="true" />}
      {layout.mobile && layout.drawer && !focused && <div className="workspace-backdrop" onClick={layout.closeDrawer} aria-hidden="true" />}
      <aside ref={layout.panel} id="workspace-sidebar" hidden={focused || (layout.compact && !layout.drawer)} className="mac-sidebar" role={layout.mobile ? 'dialog' : undefined} aria-modal={layout.mobile && layout.drawer ? true : undefined} aria-label={t('主导航')}>
        <div className="workspace-sidebar-brand" data-tauri-drag-region><WorkspaceBrand />{layout.mobile && <button type="button" className="workspace-icon-button" onClick={layout.closeDrawer} aria-label={t('关闭侧边栏')}>×</button>}</div>
        <WorkspaceNavigation {...navigation} />
        {!layout.mobile && <div {...sidebar.handleProps} className="mac-sidebar-resizer" aria-label={t('调整侧边栏宽度')} />}
      </aside>

      {queueNotice && <div role="status" className="ai-submitted-notice">{t('已加入任务队列')}<button onClick={() => { setStudying(false); setQueueNotice(false); switchTab('tasks') }}>{t('查看任务队列')}</button><button aria-label={t('关闭')} onClick={() => setQueueNotice(false)}>×</button></div>}
      {sessionStarted && <div hidden={!studying}>
        <StudyPage deckLabel={sessionDeck ? deckPath(sessionDeck, library.snapshot?.decks ?? []) : undefined} deckId={sessionDeck} key={JSON.stringify([sessionDeck,sessionScope,aheadDays,sessionVersion])} scope={sessionScope} exitLabel={sessionOrigin === 'decks' ? '返回牌组筛选' : sessionOrigin === 'library' ? '返回牌组' : sessionOrigin === 'tags' ? '返回标签筛选' : '返回我的卡片'} ahead={aheadDays} active={studying} onSessionChange={setCanResume} onExit={() => { setStudying(false); setTagStudy(sessionOrigin === 'tags'); setDeckStudy(sessionOrigin === 'decks'); setTab(sessionOrigin === 'library' ? 'library' : 'today'); if (sessionDeck && sessionOrigin === 'library') setDeckReturn(previous => ({ id: sessionDeck, revision: (previous?.revision ?? 0) + 1 })); bump() }} />
      </div>}
      {studyDetails && <StudyDetailsPage page={studyDetails} onAhead={days=>{setStudyDetails(null);setSessionDeck(null);setAheadDays(days);setSessionScope(null);setSessionOrigin('cards');setSessionVersion(v=>v+1);setSessionStarted(true);setStudying(true)}} onExit={() => setStudyDetails(null)} />}
      {deckStudy && <DeckStudyPage value={deckSelection} onChange={setDeckSelection} onStart={id => { startStudy(null, 'decks'); setSessionDeck(id) }} source={library.snapshot} error={library.error} onExit={() => setDeckStudy(false)} />}
      {tagStudy && <TagStudyPage value={tagSelection ?? []} onChange={setTagSelection} onStart={scope => startStudy(scope, 'tags')} source={library.snapshot} error={library.error} onExit={() => setTagStudy(false)} />}
      {browse && <BrowsePage cards={browse.cards} focused={browse.focused} onExit={() => setBrowse(null)} />}
      <WorkspaceToolbarContext.Provider value={{ target: toolbar, breadcrumb, page: tab }}>
      <main ref={main} {...(layout.mobile && layout.drawer ? { inert: '' } : {})} hidden={studying || tagStudy || deckStudy || browse !== null || studyDetails !== null} className={`mac-main${tab === 'tasks' ? ' mac-task-main' : ''}`}>
        <header className={`workspace-toolbar${tab === 'add' ? ' workspace-toolbar-tabs' : ''}`} data-tauri-drag-region>
          <div className="workspace-topline" data-tauri-drag-region>
            {layout.compact && <WorkspaceBrand />}
            <button ref={layout.toggle} type="button" className="workspace-icon-button workspace-toggle" aria-label={t(layout.compact && !layout.drawer ? '展开侧边栏' : '收起侧边栏')} aria-expanded={!layout.compact || layout.drawer} aria-controls="workspace-sidebar" onClick={layout.toggleSidebar}><PanelIcon /></button>
            {layout.compact && <WorkspaceNavigation {...navigation} horizontal />}
          </div>
          <div className="workspace-location">
            <nav className="workspace-root-location" aria-label={t('当前位置')}>{(currentPage ? currentPage.group : '内容') && <><span>{t(currentPage?.group ?? '内容')}</span><span aria-hidden="true">/</span></>}<h1 aria-current="page">{t(currentPage?.label ?? '帮助与导入格式')}</h1></nav>
            <div ref={setBreadcrumb} className="workspace-page-location" />
          </div>
          <div ref={setToolbar} className="workspace-toolbar-controls" data-tauri-drag-region />
        </header>
        {addOpened && <div hidden={tab !== 'add'}><AddPage cards={library.snapshot?.cards ?? []} onManage={view => { setManagementRequest(previous => ({ view, revision: (previous?.revision ?? 0) + 1 })); setTab('library') }} initialDeckId={addDeck} requestKey={addRequest} onViewTasks={() => switchTab('tasks')} onAdded={bump} onJumpToCard={jumpToCard} onViewCards={() => switchTab('library')} onHelp={() => switchTab('help')} /></div>}
        <div hidden={tab !== 'today' && tab !== 'history' && tab !== 'library'}>
            <CardManager
              section={tab === 'today' || tab === 'history' ? tab : 'library'}
              history={library.history}
              historyError={library.historyError}
              snapshot={library.snapshot}
              loadError={library.error}
              managementRequest={managementRequest}
              deckReturn={deckReturn}
              sessionDeckLabel={sessionDeck ? deckPath(sessionDeck, library.snapshot?.decks ?? []) : undefined}
              onDeckAdd={id => { setAddDeck(id); setAddRequest(v => v + 1); setAddOpened(true); setTab('add') }}
              onDeckStudy={id => { startStudy(null, "library"); setSessionDeck(id) }}
              onOpenDetails={setStudyDetails}
              refreshKey={refreshKey}
              onChanged={bump}
              canResume={canResume}
              sessionScope={sessionScope}
              onBrowse={(cards, focused) => setBrowse({ cards, focused })}
              onStudy={(scope, id) => { startStudy(scope, 'cards'); setSessionDeck(id) }}
              onChooseDeckStudy={() => setDeckStudy(true)}
              onTagStudy={scope => { setTagSelection(previous => previous ?? (Array.isArray(scope) ? scope : [])); setTagStudy(true) }}
              onResume={() => { setTagStudy(false); setStudying(true) }}
              onEditScope={() => { switchTab('settings'); requestAnimationFrame(() => document.getElementById('study-settings')?.scrollIntoView({ block: 'center' })) }}
              highlightCardId={highlightCardId}
              onHighlightConsumed={() => setHighlightCardId(null)}
            />
        </div>
        {queueError && <p role="alert" className="status-error">{queueError}</p>}
        {tab === 'tasks' && <TaskQueuePage onChanged={bump} />}
        {tab === 'settings' && <SettingsPanel ref={settings} onChanged={bump} />}
        {tab === 'help' && <ImportHelp onBack={() => switchTab(helpReturnTab)} />}
        <CloudSyncStatus onChange={bump} visible={tab === 'settings'} compactTarget={statusTarget} />
      </main>
      </WorkspaceToolbarContext.Provider>
      <footer {...(layout.mobile && layout.drawer ? { inert: '' } : {})} hidden={focused} className="workspace-footer">
        <button type="button" className="workspace-storage-status" onClick={() => switchTab('settings')} title={t('查看同步设置')}><span ref={setStatusTarget} /></button>
        <span>{library.error ? t('读取失败') : library.snapshot ? t('{0} 张卡片', library.snapshot.cards.length) : t('加载中…')}</span>
      </footer>
    </div>
  )
}
