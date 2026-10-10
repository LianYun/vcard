import { t } from '../lib/i18n'
import type { LibrarySnapshot } from '../hooks/useLibrarySnapshot'

export function StatsBar({ stats }: { stats: LibrarySnapshot['stats'] | undefined }) {
  return (
    <div className="mac-stats grid grid-cols-3 gap-3">
      <Stat label={t("今日待复习")} value={stats?.due ?? '—'} accent="text-rose-600" />
      <Stat label={t("今日新词")} value={stats?.newCards ?? '—'} accent="text-emerald-600" />
      <Stat label={t("总卡片数")} value={stats?.total ?? '—'} accent="text-brand-600" />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className="app-surface px-3 py-4 text-center">
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
    </div>
  )
}
