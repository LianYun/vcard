import { WorkspaceToolbar } from './WorkspaceToolbar'
import { calendarForecast } from '../lib/studyCalendar'
import { useEffect, useMemo, useState } from 'react'
import type { Card, StudyData } from '../types'
import { addDays, todayKey } from '../lib/date'
import { getDailyStats, type DailyStat } from '../lib/storage'
import { currentLanguage, t } from '../lib/i18n'

export function StudyCalendar({ cards, data }: { cards: Card[]; data: StudyData }) {
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [stats, setStats] = useState<DailyStat[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const first = `${month}-01`
  const [year, monthNumber] = month.split('-').map(Number)
  const next = todayKey(new Date(year, monthNumber, 1))
  const last = addDays(next, -1)
  const start = addDays(first, -(new Date(year, monthNumber - 1, 1).getDay() + 6) % 7)
  const length = Math.ceil(((new Date(year, monthNumber - 1, 1).getDay() + 6) % 7 + Number(last.slice(-2))) / 7) * 7
  useEffect(() => {
    let alive = true
    setStatus('loading')
    const request = first > today ? Promise.resolve([]) : getDailyStats(first, last < today ? last : today)
    request.then(rows => {
      if (alive) { setStats(rows); setStatus('ready') }
    }).catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [first, last, today, data])
  const actual = new Map(stats.map(row => [row.date, row]))
  const forecast = useMemo(() => {
    return calendarForecast(cards, data, today)
  }, [cards, data, today])
  const recentStart = addDays(today, -6)
  const { todayReviews, recent } = useMemo(() => {
    const active = data.reviews.filter(review => !review.undone)
    const recent = active.filter(review => review.day >= recentStart && review.day <= today)
    return {
      todayReviews: active.filter(review => review.day === today),
      recent,

    }
  }, [cards, data, today, recentStart])
  const locale = currentLanguage() === 'en' ? 'en-US' : 'zh-CN'
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' })
  const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
  const activityDays = stats.filter(s => s.reviewed > 0).length
  const monthDue = [...forecast].filter(([day]) => day >= first && day <= last).reduce((sum, [, list]) => sum + list.length, 0)
  function moveMonth(offset: number) {
    const date = todayKey(new Date(year, monthNumber - 1 + offset, 1))
    setMonth(date.slice(0, 7))
  }
  return <section className="learning-calendar" aria-label={t('学习日历')}>
    <WorkspaceToolbar page="history">
      <div className="calendar-toolbar">
        <h2>{new Date(year, monthNumber - 1, 1).toLocaleDateString(locale, { year: 'numeric', month: 'long' })}</h2>
        <div>
          <button className="btn-secondary" aria-label={t('上个月')} onClick={() => moveMonth(-1)}>‹</button>
          <button className="btn-secondary" onClick={() => { setMonth(today.slice(0, 7)) }}>{t('回到今天')}</button>
          <button className="btn-secondary" aria-label={t('下个月')} onClick={() => moveMonth(1)}>›</button>
        </div>
      </div>
    </WorkspaceToolbar>
    <div className="calendar-overview" aria-label={t('学习概览')}>
      <section className="calendar-overview-section" aria-busy={status === 'loading'}>
        <h3>{t('月度概览')}</h3>
        <dl className="calendar-metrics">
          <div><dt>{t('学习天数')}</dt><dd>{status === 'ready' ? activityDays : '—'}<small>{t('天')}</small></dd></div>
          <div><dt>{t('复习次数')}</dt><dd>{status === 'ready' ? stats.reduce((n, s) => n + s.reviewed, 0) : '—'}<small>{t('次')}</small></dd></div>
          <div><dt>{t('待复习')}</dt><dd>{monthDue}<small>{t('张')}</small></dd></div>
        </dl>
      </section>
      <section className="calendar-overview-section">
        <h3>{t('今天')} <time dateTime={today}>· {shortDate(today)}</time></h3>
        <dl className="calendar-metrics">
          <div><dt>{t('学习卡片')}</dt><dd>{new Set(todayReviews.map(r => r.cardId)).size}<small>{t('张')}</small></dd></div>
          <div><dt>{t('评分次数')}</dt><dd>{todayReviews.length}<small>{t('次')}</small></dd></div>
          <div><dt>{t('待复习')}</dt><dd>{forecast.get(today)?.length ?? 0}<small>{t('张')}</small></dd></div>
        </dl>
      </section>
      <section className="calendar-overview-section calendar-recent">
        <h3>{t('近 7 天评分分布')} <span>{shortDate(recentStart)}–{shortDate(today)}</span></h3>
        <div className="calendar-rating-meta"><strong>{recent.length ? `${Math.round(recent.filter(r => r.quality < 3).length / recent.length * 100)}%` : '—'}</strong><span>{t('遗忘率')}</span><span>{t('共 {0} 次评分', recent.length)}</span></div>
        <div className="calendar-ratings">{([[1, '重来'], [3, '困难'], [4, '良好'], [5, '简单']] as const).map(([quality, title]) => {
          const count = recent.filter(r => r.quality === quality).length
          return <div key={quality}><span>{t(title)}</span><div className="calendar-rating-track" aria-hidden="true"><i style={{ width: `${recent.length ? count / recent.length * 100 : 0}%` }} /></div><strong>{count}</strong></div>
        })}</div>
      </section>
    </div>
    {status === 'error' && <p className="calendar-notice" role="alert">{t('学习记录加载失败，请重新打开页面重试。')}</p>}
    <div className="calendar-layout">
      <section className="calendar-month" aria-label={t('月历')}>
        <div className="calendar-panel-heading"><h3>{t('月历')}</h3><span>{t('周一开始')}</span></div>
        <div className="calendar-weekdays" aria-hidden="true">{['一','二','三','四','五','六','日'].map(day => <span key={day}>{t(`周${day}`)}</span>)}</div>
        <div className="calendar-grid">{Array.from({ length }, (_, i) => {
          const day = addDays(start, i), inside = day.slice(0, 7) === month
          const count = status === 'ready' ? actual.get(day)?.reviewed ?? 0 : 0
          const due = forecast.get(day)?.length ?? 0
          return <div key={day} role="img" aria-current={day === today ? 'date' : undefined} aria-label={`${label(day)}${day === today ? ` · ${t('今天')}` : ''} · ${status === 'ready' ? t('复习 {0} 次', count) : t('准备中…')} · ${t('待复习 {0} 张', due)}`} className={`calendar-day${day === today ? ' is-today' : ''}${!inside ? ' is-outside' : ''}`}><span>{Number(day.slice(-2))}</span>{inside && <div>{count > 0 && <small className="calendar-actual">{count}</small>}{day >= today && due > 0 && <small className="calendar-planned">{due}</small>}</div>}</div>
        })}</div>
        <div className="calendar-legend"><span><i className="calendar-actual"/>{t('实际复习 · 次')}</span><span><i className="calendar-planned"/>{t('预计到期 · 张')}</span></div>
      </section>

    </div>

  </section>
}
