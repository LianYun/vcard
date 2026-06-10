// Lightweight logger. Wraps console with leveled output and a tag, so logs
// from different modules are grep-able. Set `localStorage['vibe-word:debug']
// = '1'` to enable debug-level logs in production.

type Level = 'debug' | 'info' | 'warn' | 'error'

const STYLES: Record<Level, string> = {
  debug: 'color:#94a3b8',
  info: 'color:#0ea5e9;font-weight:bold',
  warn: 'color:#f59e0b;font-weight:bold',
  error: 'color:#ef4444;font-weight:bold',
}

function debugEnabled(): boolean {
  try {
    return localStorage.getItem('vibe-word:debug') === '1' ||
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  } catch {
    return false
  }
}

function emit(level: Level, tag: string, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled()) return
  const fn = console[level] ?? console.log
  fn(`%c[${tag}]`, STYLES[level], ...args)
}

export function createLogger(tag: string) {
  return {
    debug: (...args: unknown[]) => emit('debug', tag, args),
    info: (...args: unknown[]) => emit('info', tag, args),
    warn: (...args: unknown[]) => emit('warn', tag, args),
    error: (...args: unknown[]) => emit('error', tag, args),
  }
}

// Surface uncaught errors and promise rejections that React doesn't catch.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    console.error('[uncaught error]', e.error ?? e.message, e)
  })
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[unhandled rejection]', e.reason)
  })
}
