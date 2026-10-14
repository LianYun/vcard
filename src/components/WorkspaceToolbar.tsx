import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const WorkspaceToolbarContext = createContext<{ target: HTMLElement | null; breadcrumb?: HTMLElement | null; page: string }>({ target: null, page: '' })

/** Keep page-owned controls in the window toolbar without duplicating their state. */
export function WorkspaceToolbar({ page, children }: { page: string; children: ReactNode }) {
  const workspace = useContext(WorkspaceToolbarContext)
  if (!workspace.page) return <>{children}</>
  return workspace.target && workspace.page === page ? createPortal(children, workspace.target) : null
}

/** Page-owned hierarchy follows the same mounted page state as its controls. */
export function WorkspaceBreadcrumb({ page, children }: { page: string; children: ReactNode }) {
  const workspace = useContext(WorkspaceToolbarContext)
  return workspace.breadcrumb && workspace.page === page ? createPortal(children, workspace.breadcrumb) : null
}
