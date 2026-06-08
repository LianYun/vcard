// Date helpers. The scheduler deals in whole-day granularity and keys state by
// local YYYY-MM-DD, so all date math goes through these deterministic helpers.

/** Return today's YYYY-MM-DD in local time. */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Add N days to a YYYY-MM-DD string and return the resulting YYYY-MM-DD. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  return todayKey(base)
}

/** True if `dateKey` is today or earlier (i.e. the card is due). */
export function isDueOrBefore(dateKey: string, refKey: string = todayKey()): boolean {
  return dateKey <= refKey
}
