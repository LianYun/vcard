import type { StudyDetailsSnapshot } from '../hooks/useLibrarySnapshot'
import { useEffect, useMemo, useState } from 'react'
import type { Card, StudyData } from '../types'
import { allCards } from '../lib/cardStore'
import { loadStudyData } from '../lib/storage'
import { aheadCards, available } from '../lib/study'
import { addDays, todayKey } from '../lib/date'
import { t } from '../lib/i18n'

export type StudyDetails = 'ahead' | 'stats'

export function StudyDetailsPage({page,onAhead,onExit,embedded=false,snapshot,loadError}:{snapshot?:StudyDetailsSnapshot|null;loadError?:string|null;page:StudyDetails;onAhead:(days:number)=>void;onExit:()=>void;embedded?:boolean}) {
  const [loadedCards,setCards]=useState<Card[]>([])
  const [loadedData,setData]=useState<StudyData|null>(null)
  const [days,setDays]=useState(1)
  const [error,setError]=useState('')
  const cards = snapshot === undefined ? loadedCards : snapshot?.cards ?? []
  const data = snapshot === undefined ? loadedData : snapshot?.data ?? null
  const displayError = loadError ?? error
  useEffect(()=>{
    if (snapshot !== undefined) return
    let alive=true
    Promise.all([allCards(),loadStudyData()]).then(([c,d])=>{if(alive){setCards(c);setData(d)}}).catch(e=>{if(alive)setError(String(e))})
    if (!embedded) window.scrollTo(0,0)
    return()=>{alive=false}
  },[embedded, snapshot])
  const today=todayKey()
  const matches=useMemo(() => page === 'ahead' && data ? aheadCards(cards,data.progress,data.controls,days) : [], [page,cards,data,days,today])
  const { todayReviews, recent, difficult } = useMemo(() => {
    const reviews=data?.reviews.filter(r=>!r.undone) ?? []
    const todayReviews=reviews.filter(r=>r.day===today)
    const recent=reviews.filter(r=>r.day>=addDays(today,-6))
    const forgotten = new Map<string, number>()
    for (const review of recent) if (review.quality < 3) {
      forgotten.set(review.cardId, (forgotten.get(review.cardId) ?? 0) + 1)
    }
    const difficult=cards.map(card=>({card,count:forgotten.get(card.id) ?? 0})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,10)
    return { todayReviews, recent, difficult }
  }, [cards,data,today])
  return <section className={embedded ? "study-records" : "browse-page"}>
    {!embedded && <header className="browse-header"><div className="browse-header-inner">
      <button autoFocus className="btn-secondary" onClick={onExit}>{t('返回我的卡片')}</button>
    </div></header>}
    <div className={embedded ? undefined : "browse-content"}>
      {!embedded && <div className="browse-intro"><h1 className="text-2xl font-semibold tracking-tight">{t(page==='ahead'?'提前学习':'学习数据')}</h1></div>}
      <div className="study-hub study-details app-surface" aria-busy={!data&&!displayError}>
        {displayError&&<p role="alert" className="text-red-600">{displayError}</p>}
        {page==='stats'&&!data&&!displayError&&<p role="status">{t('准备中…')}</p>}
    {page==='ahead'&&<div className="study-hub-panel">
      <h3>{t('提前学一点，为接下来留出时间')}</h3>
      <p>{t('学习明天起未来 1–5 天到期的已学卡片，不占新卡额度。评分计入正式复习，按今天更新排程。')}</p>
      <div className="study-segments" aria-label={t('提前学习天数')}>{[1,2,3,4,5].map(n=><button aria-pressed={days===n} key={n} onClick={()=>setDays(n)}>{n} {t('天')}</button>)}</div>
      <div className="study-ahead-summary"><div><strong>{matches.length}</strong> {t('张可提前学习')}<p>{addDays(today,1)} — {addDays(today,days)}</p></div><button className="btn-primary" disabled={!matches.length} onClick={()=>onAhead(days)}>{t('开始提前学习')}</button></div>
      <p>{t('暂停、今天跳过及等待短间隔重学的卡片不会加入。')}</p>
      {matches.length ? <ul className="study-preview-list">{matches.slice(0,5).map(c=><li key={c.id}><span>{c.front.split('\n')[0]}</span><time>{data?.progress[c.id].due}</time></li>)}</ul>:<div className="study-empty">{t('这个时间范围内没有待复习卡片，可以换一个天数。')}</div>}
    </div>}
    {page==='stats'&&data&&<div className="study-hub-panel">
      <div className="study-metrics"><div><strong>{new Set(todayReviews.map(r=>r.cardId)).size}</strong>{t('今日学习张数')}</div><div><strong>{todayReviews.length}</strong>{t('今日评分次数')}</div><div><strong>{recent.length?`${Math.round(recent.filter(r=>r.quality<3).length/recent.length*100)}%`:'—'}</strong>{t('近 7 天遗忘率')}</div></div>
      <p>{t('评分明细从本次升级起记录；旧版累计活动仍保留在学习记录中。')}</p>
      <h4>{t('近 7 天评分分布')}</h4><div className="study-segments">{[[1,'重来'],[3,'困难'],[4,'良好'],[5,'简单']].map(([q,label])=><span key={q}>{t(String(label))} · {recent.filter(r=>r.quality===q).length}</span>)}</div>
      <h4>{t('未来 7 天到期')}</h4><div className="study-forecast">{Array.from({length:7},(_,i)=>{
        const day=addDays(today,i+1),count=cards.filter(c=>available(data.controls[c.id],day)&&data.progress[c.id]?.lastReviewedAt!=null&&data.progress[c.id]?.due===day).length
        return <div key={day}><time>{day.slice(5)}</time><meter min={0} max={Math.max(1,cards.length)} value={count}/><strong>{count}</strong></div>
      })}</div><p>{t('根据当前排程汇总，后续评分会改变到期量。')}</p>
      <h4>{t('最近反复忘记的卡片')}</h4><ul className="study-preview-list">{difficult.map(({card,count})=><li key={card.id}><span>{card.front.split('\n')[0]}</span><span>{count} {t('次')}</span></li>)}</ul>{!difficult.length&&<p>{t('最近没有遗忘记录。')}</p>}
    </div>}
      </div>
    </div>
  </section>
}
