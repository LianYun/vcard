// GitHub-style contribution heatmap. Shows the last ~26 weeks of activity
// (reviewed + added per day). Pure SVG, no external dependencies.

import { useEffect, useMemo, useState } from 'react'
import { addDays, todayKey } from '../lib/date'
import { createLogger } from '../lib/log'
import { getDailyStats } from '../lib/storage'
import type { DailyStat } from '../lib/storage'

const log = createLogger('heatmap')

const WEEKS = 26  // ~half a year
const CELL = 12
const GAP = 3
const DAYS_PER_WEEK = 7

function colorFor(total: number): string {
  if (total === 0) return '#ebedf0'
  if (total <= 2) return '#9be9a8'
  if (total <= 5) return '#40c463'
  if (total <= 9) return '#30a14e'
  return '#216e39'
}

function formatDate(d: string): string {
  const [, m, day] = d.split('-')
  return `${m}/${day}`
}

interface Cell {
  date: string
  reviewed: number
  added: number
  total: number
  inFuture: boolean
}

interface Props {
  refreshKey?: number
}

export function ActivityHeatmap({ refreshKey = 0 }: Props) {
  const [statsByDate, setStatsByDate] = useState<Record<string, DailyStat>>({})
  const [tooltip, setTooltip] = useState<{ x: number; y: number; cell: Cell } | null>(null)

  const today = todayKey()
  // First column = (WEEKS-1) weeks ago, anchored on Sunday of that week.
  const firstDate = useMemo(() => {
    const now = new Date()
    const dow = now.getDay() // 0=Sun
    // Days back to most recent Sunday + (WEEKS-1)*7
    const back = dow + (WEEKS - 1) * 7
    return addDays(today, -back)
  }, [today])

  useEffect(() => {
    getDailyStats(firstDate, today)
      .then((rows) => {
        log.debug('loaded daily stats', { count: rows.length, range: [firstDate, today] })
        const map: Record<string, DailyStat> = {}
        for (const r of rows) map[r.date] = r
        setStatsByDate(map)
      })
      .catch((err) => log.error('getDailyStats failed', err))
  }, [firstDate, today, refreshKey])

  const cells: Cell[][] = useMemo(() => {
    const grid: Cell[][] = []
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = []
      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const date = addDays(firstDate, w * 7 + d)
        const stat = statsByDate[date]
        const reviewed = stat?.reviewed ?? 0
        const added = stat?.added ?? 0
        col.push({
          date,
          reviewed,
          added,
          total: reviewed + added,
          inFuture: date > today,
        })
      }
      grid.push(col)
    }
    return grid
  }, [firstDate, statsByDate, today])

  const totals = useMemo(() => {
    const allStats = Object.values(statsByDate)
    const activeDays = allStats.filter((s) => s.reviewed + s.added > 0).length
    const totalReviewed = allStats.reduce((sum, s) => sum + s.reviewed, 0)
    const totalAdded = allStats.reduce((sum, s) => sum + s.added, 0)

    // Current streak: count back from today while active.
    let streak = 0
    let cursor = today
    while (true) {
      const s = statsByDate[cursor]
      if (!s || s.reviewed + s.added === 0) break
      streak += 1
      cursor = addDays(cursor, -1)
    }
    return { activeDays, totalReviewed, totalAdded, streak }
  }, [statsByDate, today])

  const width = WEEKS * (CELL + GAP)
  const height = DAYS_PER_WEEK * (CELL + GAP)

  return (
    <div className="app-surface p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-800">学习记录</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>连续 <span className="font-semibold text-orange-600">{totals.streak}</span> 天</span>
          <span>累计 <span className="font-semibold text-slate-700">{totals.activeDays}</span> 天</span>
          <span>复习 <span className="font-semibold text-slate-700">{totals.totalReviewed}</span></span>
          <span>新增 <span className="font-semibold text-slate-700">{totals.totalAdded}</span></span>
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <svg width={width} height={height} className="block">
          {cells.map((col, w) =>
            col.map((cell, d) => {
              const x = w * (CELL + GAP)
              const y = d * (CELL + GAP)
              const fill = cell.inFuture ? 'transparent' : colorFor(cell.total)
              return (
                <rect
                  key={cell.date}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={fill}
                  stroke={cell.inFuture ? '#f1f5f9' : 'none'}
                  strokeWidth={cell.inFuture ? 1 : 0}
                  onMouseEnter={(e) => {
                    if (cell.inFuture) return
                    const rect = (e.currentTarget.ownerSVGElement as SVGElement).getBoundingClientRect()
                    setTooltip({
                      x: rect.left + x + CELL / 2,
                      y: rect.top + y,
                      cell,
                    })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: cell.inFuture ? 'default' : 'pointer' }}
                />
              )
            }),
          )}
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-800 px-2 py-1 text-xs text-white shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 6 }}
          >
            <div className="font-medium">{formatDate(tooltip.cell.date)}</div>
            <div>复习 {tooltip.cell.reviewed}　新增 {tooltip.cell.added}</div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-slate-400">
        <span>少</span>
        {[0, 2, 5, 9, 10].map((n) => (
          <span
            key={n}
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: colorFor(n) }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}
