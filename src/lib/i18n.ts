import { useSyncExternalStore } from 'react'
import english from '../locales/en.json'
import { loadLanguage, saveLanguage, type LanguagePreference } from './storage'

export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): 'zh-Hans' | 'en' {
  if (preference !== 'system') return preference
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-Hans'
    if (/^en(?:-|$)/i.test(language)) return 'en'
  }
  return 'en'
}
const listeners = new Set<() => void>()
export function currentLanguage() { return resolveLanguage(loadLanguage(), navigator.languages) }
function notify() {
  document.documentElement.lang = currentLanguage()
  listeners.forEach(listener => listener())
}
window.addEventListener('languagechange', notify)
window.addEventListener('storage', notify)
export function setLanguage(value: LanguagePreference) { saveLanguage(value); notify() }
export function useLanguage() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => `${loadLanguage()}:${currentLanguage()}`)
  return loadLanguage()
}
const messages: Record<string, string> = english
export function t(key: string, ...values: unknown[]): string {
  const template = currentLanguage() === 'en' ? messages[key] ?? key : key
  return template.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match)
}
notify()

// Translate only app-owned status/error messages, never card or model content.
const legacyTemplates = Object.entries(messages).filter(([key]) => key.includes('{0}'))
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, translation]) => ({ translation, pattern: new RegExp('^' + key.split(/\{\d+\}/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$', 's') }))
export function localizedMessage(message: string): string {
  if (currentLanguage() !== 'en') return message
  if (messages[message]) return messages[message]
  if (message.startsWith('Error: ')) return 'Error: ' + localizedMessage(message.slice(7))
  for (const { pattern, translation } of legacyTemplates) {
    const match = message.match(pattern)
    if (match) return translation.replace(/\{(\d+)\}/g, (_, index: string) => match[Number(index) + 1])
  }
  return message
}
