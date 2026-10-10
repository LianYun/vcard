import { useEffect, useState } from 'react'
import { fileStorageAction, loadCloudStatus } from '../lib/storage'
import { localizedMessage, t } from '../lib/i18n'

export function CardsJSONAction({ kind, onChanged }: { kind: 'importCards' | 'exportCards'; onChanged?: () => void }) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void loadCloudStatus().then(status => { if (active) setAvailable(status !== null) }).catch(() => {}); return () => { active = false } }, [])
  if (!available) return null
  async function run() {
    setBusy(true); setError(''); setMessage('')
    try {
      const count = await fileStorageAction(kind)
      if (kind === 'importCards' && count !== null) {
        setMessage(t('已导入或更新 {0} 张卡片', count))
        onChanged?.()
        window.dispatchEvent(new Event('vibe-library-changed'))
      }
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  return <div>
    <button className="btn-secondary" disabled={busy} onClick={() => void run()}>{busy ? t('处理中…') : kind === 'importCards' ? t('导入卡片 CSV / JSON') : t('导出卡片 JSON')}</button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{localizedMessage(error)}</p>}
  </div>
}
