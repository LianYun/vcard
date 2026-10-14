import { StudyCalendar } from './StudyCalendar'
import type { StudyDetailsSnapshot } from '../hooks/useLibrarySnapshot'
import { useEffect, useMemo, useState } from 'react'
import type { Card, StudyData } from '../types'
import { allCards } from '../lib/cardStore'
import { loadStudyData } from '../lib/storage'
import { aheadCards } from '../lib/study'
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
  return <section className={embedded ? "study-records" : "browse-page"}>
    {!embedded && <header className="browse-header" data-tauri-drag-region><div className="browse-header-inner">
      <button autoFocus className="btn-secondary" onClick={onExit}>{t('返回我的卡片')}</button><h1 className="focus-page-title">{t(page==='ahead'?'提前学习':'学习数据')}</h1>
    </div></header>}
    <div className={embedded ? undefined : "browse-content"}>
      {page==='stats'&&data&&<StudyCalendar cards={cards} data={data} />}
      <div className={`study-hub study-details${page==='stats' ? ' calendar-load-status' : ' app-surface'}`} aria-busy={!data&&!displayError}>
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
      </div>
    </div>
  </section>
}
