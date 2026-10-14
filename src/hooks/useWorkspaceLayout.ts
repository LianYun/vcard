import { useEffect, useRef, useState } from 'react'
import { loadSidebarCollapsed, saveSidebarCollapsed } from '../lib/storage'

export function useWorkspaceLayout() {
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [drawer, setDrawer] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const change = () => { setMobile(media.matches); setDrawer(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!drawer || !mobile) return
    const previous = document.activeElement as HTMLElement | null
    const buttons = () => Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    buttons()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(false) }
      if (event.key !== 'Tab') return
      const items = buttons(), first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); previous?.focus() }
  }, [drawer, mobile])
  function toggleSidebar() {
    if (mobile) setDrawer(value => !value)
    else setCollapsed(value => { saveSidebarCollapsed(!value); return !value })
  }
  return { compact: mobile || collapsed, mobile, drawer, panel, toggle, toggleSidebar, closeDrawer: () => setDrawer(false) }
}
