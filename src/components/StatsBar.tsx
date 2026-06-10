import { useEffect, useState } from 'react'
import { allCards } from '../lib/cardStore'
import { loadMeta, loadProgress, loadSettings } from '../lib/storage'
import { schedule } from '../lib/scheduler'
import { todayKey } from '../lib/date'

interface Props {
  refreshKey: number
}

export function StatsBar({ refreshKey }: Props) {
  const [stats, setStats] = useState({ due: 0, newCards: 0, total: 0 })

  useEffect(() => {
    async function load() {
      const [cards, progress, settings, meta] = await Promise.all([
        allCards(),
        loadProgress(),
        loadSettings(),
        loadMeta(),
      ])
      const today = todayKey()
      const effectiveMeta = meta.newCardsDate === today
        ? meta
        : { newCardsDate: today, newCardsIssued: 0 }
      const result = schedule(cards, progress, settings, effectiveMeta)
      setStats({
        due: result.dueReviews.length,
        newCards: result.newCards.length,
        total: cards.length,
      })
    }
    load()
  }, [refreshKey])

  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="今日待复习" value={stats.due} accent="text-rose-600" />
      <Stat label="今日新词" value={stats.newCards} accent="text-emerald-600" />
      <Stat label="总卡片数" value={stats.total} accent="text-brand-600" />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  )
}
