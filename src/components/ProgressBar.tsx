// Session progress bar: shows done / total with a fill and a counter.

interface Props {
  done: number
  total: number
}

export function ProgressBar({ done, total }: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="app-surface w-full px-4 py-3">
      <div className="mb-2 flex justify-between text-xs font-semibold text-slate-500">
        <span>
          {done} / {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
