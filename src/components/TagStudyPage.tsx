import { useEffect, useState } from 'react'
import { allCards } from '../lib/cardStore'
import { loadMeta, loadSettings, loadStudyData } from '../lib/storage'
import { selectStudyCards } from '../lib/study'
import { localizedMessage, t } from '../lib/i18n'
import { TagSelector } from './TagSelector'

export function TagStudyPage({ value, onChange, onStart, onExit, refreshKey }: {
  value: string[]; onChange: (tags: string[]) => void; onStart: (tags: string[]) => void; onExit: () => void; refreshKey: number
}) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof read>> | null>(null)
  const [error, setError] = useState('')
  async function read() {
    const [cards, data, settings, meta] = await Promise.all([allCards(), loadStudyData(), loadSettings(), loadMeta()])
    return { cards, data, settings, meta }
  }
  useEffect(() => {
    let disposed = false, request = 0
    const refresh = () => { const id = ++request; void read().then(data => { if (!disposed && id === request) { setSource(data); setError('') } }).catch(err => { if (!disposed) setError(String(err)) }) }
    refresh()
    window.addEventListener('vibe-library-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; window.removeEventListener('vibe-library-changed', refresh); window.removeEventListener('focus', refresh) }
  }, [refreshKey])
  const selection = source && selectStudyCards(source.cards, source.data, source.settings, source.meta, value)
  const total = selection ? selection.reviews.length + selection.fresh.length : 0
  return <section className="app-container space-y-5 tag-study-page">
    <button className="study-quiet" onClick={onExit}>{t('‹ 返回我的卡片')}</button>
    <h2 className="text-2xl font-bold">{t('按标签学习')}</h2>
    <p className="section-copy">{t('仅用于本次学习，不修改默认学习范围。')}</p>
    {error && <p role="alert">{localizedMessage(error)}</p>}
    {!source ? <p role="status">{t('准备中…')}</p> : <div className="app-surface p-5 space-y-5">
      <TagSelector cards={source.cards} value={value} onChange={onChange} />
      {selection && <div aria-live="polite" className="space-y-2">
        <p>{t('本次可学：待复习 {0} 张 · 新卡 {1} 张', selection.reviews.length, selection.fresh.length)}</p>
        <p className="section-copy">{t('今日新卡剩余额度：{0} 张', selection.budget)}</p>
        {total === 0 && <p>{!value.length ? t('请至少选择一个标签') : selection.matching.length === 0 ? t('没有匹配卡片，请选择其他标签') : selection.freshCount > 0 && selection.budget === 0 ? t('今日新卡额度已用完') : t('当前范围暂无待学卡片')}</p>}
      </div>}
      <button className="btn-primary" disabled={total === 0 || !!error} onClick={() => onStart(value)}>{t('开始学习 · {0} 张', total)}</button>
    </div>}
  </section>
}
