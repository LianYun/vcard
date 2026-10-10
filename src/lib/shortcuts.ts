export const DEFAULT_SHORTCUTS = {
  flip: ' ', again: 'a', hard: 's', good: 'd', easy: 'e', undo: 'z', mark: 'm',
  previous: 'ArrowLeft', next: 'ArrowRight',
}
export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS
export type Shortcuts = Record<ShortcutAction, string>
export const SHORTCUT_ACTIONS: { action: ShortcutAction; label: string }[] = [
  { action: 'flip', label: '翻面' }, { action: 'again', label: '重来' },
  { action: 'hard', label: '困难' }, { action: 'good', label: '良好' },
  { action: 'easy', label: '简单' }, { action: 'undo', label: '撤销评分' },
  { action: 'mark', label: '标记卡片' }, { action: 'previous', label: '上一张（快速学习）' },
  { action: 'next', label: '下一张（快速学习）' },
]
export const SHORTCUT_KEYS = ['', ' ', ...'abcdefghijklmnopqrstuvwxyz0123456789', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
export function shortcutLabel(key: string): string {
  return ({ '': '未设置', ' ': '空格', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' } as Record<string, string>)[key] ?? key.toUpperCase()
}
export function validShortcuts(value: unknown): value is Shortcuts {
  if (!value || typeof value !== 'object') return false
  const keys = SHORTCUT_ACTIONS.map(({ action }) => (value as Shortcuts)[action])
  return keys.every(key => SHORTCUT_KEYS.includes(key)) && new Set(keys.filter(Boolean)).size === keys.filter(Boolean).length
}
export function normalizeShortcuts(value: unknown): Shortcuts {
  return validShortcuts(value) ? { ...value } : { ...DEFAULT_SHORTCUTS }
}
export function shortcutAction(event: KeyboardEvent, shortcuts: Shortcuts): ShortcutAction | undefined {
  if (typeof document !== 'undefined' && document.querySelector('dialog[open][data-block-study-shortcuts]')) return
  if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return
  return SHORTCUT_ACTIONS.find(({ action }) => shortcuts[action] && shortcuts[action] === (event.key.length === 1 ? event.key.toLowerCase() : event.key))?.action
}
