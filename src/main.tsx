import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CardEditorProvider } from './components/CardEditor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { createLogger } from './lib/log'
import './index.css'
import './theme.css'
import './mac.css'
import './lib/theme'

const log = createLogger('main')

function showBootError(message: string): void {
  const overlay = document.getElementById('boot-error')
  const text = document.getElementById('boot-error-text')
  if (overlay && text) {
    text.textContent = message
    overlay.style.display = 'block'
  }
}

try {
  log.info('app starting', {
    isTauri: '__TAURI_INTERNALS__' in window,
    userAgent: navigator.userAgent,
    href: location.href,
  })

  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('#root element not found in index.html')

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <CardEditorProvider><App /></CardEditorProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
  log.info('react mounted')
} catch (err) {
  log.error('boot failed', err)
  const e = err as Error
  showBootError(`${e.name ?? 'Error'}: ${e.message}\n\n${e.stack ?? '(no stack)'}`)
}
