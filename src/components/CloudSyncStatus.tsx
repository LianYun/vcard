import { localizedMessage, t } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { authorizeCloudSync, loadCloudStatus, type CloudStatus } from '../lib/storage'

export function CloudSyncStatus({ onChange, visible }: { onChange: () => void; visible: boolean }) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const revision = useRef<number>()

  function applyStatus(next: CloudStatus | null) {
    if (!next) return
    setStatus(next)
    const observed = next.syncRevision ?? next.revision
    if (revision.current !== undefined && observed !== revision.current) {
      onChange()
      window.dispatchEvent(new Event('vibe-library-changed'))
    }
    revision.current = observed
  }

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await loadCloudStatus()
        if (stopped || !next) return
        applyStatus(next)
        setError(null)
      } catch (err) { if (!stopped) setError(String(err)) }
      if (!stopped) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [onChange])

  async function check(authorize = false) {
    setChecking(true)
    try { applyStatus(await (authorize ? authorizeCloudSync() : loadCloudStatus(true))); setError(null) }
    catch (err) { setError(String(err)) }
    finally { setChecking(false) }
  }
  // Keep observing library revisions on every tab; only show controls in Settings.
  if (!visible || (!status && !error)) return null
  return <aside className="app-surface settings-section mt-5" aria-labelledby="cloud-sync-heading">
    <div className="settings-heading"><h3 id="cloud-sync-heading" className="section-title">{t('同步状态')}</h3></div>
    <p className={`section-copy break-words${error ? ' text-red-600' : ''}`} role="status" aria-live="polite">{localizedMessage(error ?? status?.message ?? "")}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="btn-secondary min-h-11" onClick={() => void check(Boolean(status?.needsAuthorization))} disabled={checking || !status?.enabled}>
        {checking ? t("处理中…") : t(status?.needsAuthorization ? "重新授权同步目录" : "立即同步")}
      </button>
    </div>
  </aside>
}
