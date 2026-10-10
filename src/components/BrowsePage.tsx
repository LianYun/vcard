import { useCardEditor } from './CardEditor'
import { allCards } from '../lib/cardStore'
import { useShortcuts } from '../hooks/useShortcuts'
import { shortcutAction } from '../lib/shortcuts'
import { useEffect, useState } from 'react'
import type { Card, StudyData, StudyFilter } from '../types'
import { t } from '../lib/i18n'
import { matchesTag, normalizeTags } from '../lib/tags'
import { loadStudyData } from '../lib/storage'
import { FILTERS, matchesStudy, shuffleStudyCards } from '../lib/study'
import { CardView } from './CardView'

// This session only holds cards and presentation state; it never issues or grades cards.
export function BrowsePage({ cards, onExit }: { cards: Card[]; onExit: () => void }) {
  const openEditor = useCardEditor()
  const shortcuts = useShortcuts()
  const [filter,setFilter]=useState<StudyFilter>('all')
  const [limit,setLimit]=useState(20)
  const [data,setData]=useState<StudyData|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{loadStudyData().then(setData).catch(e=>setError(String(e)))},[])
  const [all, setAll] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [session, setSession] = useState<Card[] | null>(null)
  useEffect(() => {
    let live = true
    const refresh = () => { void allCards().then(latest => { if (live) setSession(previous => previous?.flatMap(card => { const updated = latest.find(c => c.id === card.id); return updated ? [updated] : [] }) ?? null) }).catch(e => { if (live) setError(String(e)) }) }
    window.addEventListener('vibe-library-changed', refresh)
    return () => { live = false; window.removeEventListener('vibe-library-changed', refresh) }
  }, [])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const tags = [...new Set(cards.flatMap(card => normalizeTags(card.tags)))].sort((a, b) => a.localeCompare(b))
  const matching = cards.filter(card => (all || selected.some(tag => matchesTag(card, tag))) && (data ? matchesStudy(card,filter,data.progress,data.controls,data.reviews) : filter==='all'))
  useEffect(() => { setIndex(previous => Math.min(previous, Math.max(0, (session?.length ?? 1) - 1))) }, [session?.length])
  const current = session?.[index]
  function move(next: number) {
    if (!session || next < 0 || next >= session.length) return
    setIndex(next); setFlipped(false)
  }
  useEffect(() => {
    if (!session) return
    function keydown(event: KeyboardEvent) {
      const action = shortcutAction(event, shortcuts)
      if (action === 'previous' || action === 'next') {
        event.preventDefault(); move(index + (action === 'previous' ? -1 : 1))
      } else if (action === 'flip') {
        event.preventDefault(); setFlipped(value => !value)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [session, index, shortcuts])
  return <section className="browse-page">
    <header className="browse-header"><div className="browse-header-inner">
      <button className="btn-secondary" onClick={onExit}>{t('返回我的卡片')}</button>
      {session && <button className="btn-secondary" onClick={() => { setSession(null); setFlipped(false) }}>{t('重新选择标签')}</button>}
    </div></header>
    <div className="browse-content">
      <div className="browse-intro">
        <h1 className="text-2xl font-semibold tracking-tight">{t('快速学习')}</h1>
        <p className="text-sm text-slate-500">{t('不记录掌握程度，不影响学习进度和每日额度')}</p>
      </div>
      {!session ? <div className="app-surface browse-setup">
        {error && <p className="status-error" role="alert">{error}</p>}
        <div className="browse-settings">
          <label className="browse-setting">
            <span>{t('专项范围')}</span>
            <select className="app-field browse-select" value={filter} onChange={event => setFilter(event.target.value as StudyFilter)}>
              {FILTERS.filter(item => item.value !== 'suspended').map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
            </select>
          </label>
          <fieldset className="browse-setting">
            <legend>{t('每轮数量')}</legend>
            <div className="browse-quantity">
              {[10, 20, 50].map(number => <button key={number} type="button" aria-pressed={limit === number} onClick={() => setLimit(number)}>{number}</button>)}
            </div>
          </fieldset>
        </div>
        <fieldset className="browse-scope" aria-describedby="browse-scope-hint">
          <legend>{t('选择学习范围')}</legend>
          <p id="browse-scope-hint" className="section-copy">{t('可多选标签，包含任一所选标签的卡片都会加入')}</p>
          <label className={`browse-all${all ? ' is-selected' : ''}`}>
            <input type="checkbox" checked={all} onChange={event => { setAll(event.target.checked); setSelected([]) }} />
            <span>{t('全部卡片')}</span><span className="browse-count">{cards.length}</span>
          </label>
          <div className="browse-tags">{['', ...tags].map(tag => <label key={tag} className={`browse-tag${!all && selected.includes(tag) ? ' is-selected' : ''}`}>
            <input type="checkbox" checked={!all && selected.includes(tag)} onChange={() => {
              setAll(false); setSelected(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag])
            }} />
            <span className="browse-tag-name">{tag || t('未打标签')}</span>
            <span className="browse-count">{cards.filter(card => matchesTag(card, tag)).length}</span>
          </label>)}</div>
        </fieldset>
        <div className="browse-summary">
          <div role="status" aria-live="polite">
            <p className="browse-total">{t('共 {0} 张卡片', matching.length)}</p>
            <p className="section-copy">{matching.length ? t('本轮学习 {0} 张', Math.min(matching.length, limit)) : t('暂无符合条件的卡片，请调整范围或标签')}</p>
          </div>
          <button className="btn-primary browse-start" disabled={!matching.length} onClick={() => { setSession(shuffleStudyCards(matching).slice(0,limit)); setIndex(0); setFlipped(false) }}>
            {t('开始快速学习')}<span aria-hidden="true">→</span>
          </button>
        </div>
      </div> : <>
        {current && <><button className="btn-secondary mb-3" onClick={() => openEditor({ kind: 'card', id: current.id })}>{t('编辑内容')}</button><CardView key={current.id} card={current} flipped={flipped} onFlipChange={setFlipped} /></>}
        <div className="mt-5 flex items-center justify-between gap-3">
          <button className="btn-secondary" disabled={index === 0} onClick={() => move(index - 1)}>{t('上一张')}</button>
          <span role="status">{index + 1} / {session.length}</span>
          <button className="btn-secondary" disabled={index >= session.length - 1} onClick={() => move(index + 1)}>{t('下一张')}</button>
        </div>
      </>}
    </div>
  </section>
}
