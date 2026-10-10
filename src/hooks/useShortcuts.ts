import { useEffect, useState } from 'react'
import { loadShortcuts } from '../lib/storage'
import { normalizeShortcuts } from '../lib/shortcuts'

export function useShortcuts() {
  const [shortcuts, setShortcuts] = useState(() => normalizeShortcuts(loadShortcuts()))
  useEffect(() => {
    const refresh = () => setShortcuts(normalizeShortcuts(loadShortcuts()))
    window.addEventListener('vibe-shortcuts-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('vibe-shortcuts-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return shortcuts
}
