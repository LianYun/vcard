// Today's at-a-glance counts: due reviews and new cards scheduled for today,
// plus total cards in the system.

import { useMemo } from 'react'
import { allCards } from '../lib/cardStore'
import { loadMeta, loadProgress, loadSettings } from '../lib/storage'
import type { Meta } from '../lib/storage'
import { schedule } from '../lib/scheduler'
import { todayKey } from '../lib/date'

interface Props {
  refreshKey: number
}

function effectiveMeta(): Meta {
  const m = loadMeta()
  const today = todayKey()
  return m.newCardsDate === today
    ? m
    : { newCardsDate: today, newCardsIssued: 0 }
}

export function StatsBar({ refreshKey }: Props) {
  const stats = useMemo(() => {
    const today = schedule(allCards(), loadProgress(), loadSettings(), effectiveMeta())
    return {
      due: today.dueReviews.length,
      newCards: today.newCards.length,
      total: allCards().length,
    }
    // refreshKey bumps recompute after add/edit/delete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
