// Session progress bar: shows done / total with a fill and a counter.

interface Props {
  done: number
  total: number
}

export function ProgressBar({ done, total }: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs font-medium text-slate-500">
        <span>
          {done} / {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
