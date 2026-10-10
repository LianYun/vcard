import { useSyncExternalStore } from 'react'
import { loadTheme, saveTheme, type ThemePreference } from './storage'

const listeners = new Set<() => void>()
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const preference = loadTheme()
  document.documentElement.dataset.theme = preference === 'system'
    ? (systemTheme.matches ? 'dark' : 'light')
    : preference
  listeners.forEach(listener => listener())
}
export function setTheme(value: ThemePreference) {
  saveTheme(value)
  applyTheme()
}
export function useTheme() {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, loadTheme)
}
window.addEventListener('storage', applyTheme)
systemTheme.addEventListener('change', applyTheme)
applyTheme()
