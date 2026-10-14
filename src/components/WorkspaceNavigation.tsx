import appIcon from '../../src-tauri/icons/128x128.png'
import { t } from '../lib/i18n'

export type WorkspacePage = 'today' | 'history' | 'library' | 'add' | 'tasks' | 'settings' | 'help'
export const WORKSPACE_PAGES: { key: WorkspacePage; label: string; group?: string }[] = [
  { key: 'today', label: '今日练习', group: '学习' },
  { key: 'history', label: '学习日历', group: '学习' },
  { key: 'library', label: '卡片库', group: '内容' },
  { key: 'add', label: '添加', group: '内容' },
  { key: 'tasks', label: '任务队列', group: '内容' },
  { key: 'settings', label: '设置' },
]
export function WorkspaceBrand() {
  return <img className="workspace-brand" src={appIcon} alt="Vibe Word" width={32} height={32} draggable={false} />
}
export function PanelIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
}
function PageIcon({ page }: { page: WorkspacePage }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {page === 'today' ? <path d="M8 5l11 7-11 7z"/> : page === 'history' ? <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></> : page === 'library' ? <><rect x="7" y="6" width="13" height="15" rx="2"/><path d="M16 3H5a2 2 0 0 0-2 2v12M11 11h5M11 15h5"/></> : page === 'add' ? <path d="M12 5v14M5 12h14"/> : page === 'tasks' ? <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/></> : <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--ui-bg)"/><circle cx="15" cy="17" r="3" fill="var(--ui-bg)"/></>}
  </svg>
}
export function WorkspaceNavigation({ page, onNavigate, ready, running, horizontal = false }: {
  page: WorkspacePage; onNavigate: (page: WorkspacePage) => void; ready: number; running: boolean; horizontal?: boolean
}) {
  return <nav aria-label={t('主导航')} className={horizontal ? 'workspace-top-nav' : 'workspace-side-nav'}>
    {WORKSPACE_PAGES.map((item, index) => <div key={item.key} className={item.key === 'settings' ? 'workspace-settings-link' : undefined}>
      {!horizontal && item.group && item.group !== WORKSPACE_PAGES[index - 1]?.group && <p className="workspace-nav-group">{t(item.group)}</p>}
      <button type="button" onClick={() => onNavigate(item.key)} aria-current={page === item.key ? 'page' : undefined} className="mac-nav-item">
        <PageIcon page={item.key}/><span className="mac-nav-label">{t(item.label)}</span>
        {item.key === 'tasks' && <span className="mac-task-status">{ready > 0 && <small className="task-badge">{ready}</small>}{running && <span className="task-running" aria-label={t('生成中')}>●</span>}</span>}
      </button>
    </div>)}
  </nav>
}
