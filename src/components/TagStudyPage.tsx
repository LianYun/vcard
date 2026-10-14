import type { LibrarySnapshot } from '../hooks/useLibrarySnapshot'
import { selectStudyCards } from '../lib/study'
import { localizedMessage, t } from '../lib/i18n'
import { DeckPicker } from './DeckEditor'
import { inDeck } from '../lib/decks'
import { TagSelector } from './TagSelector'

export function TagStudyPage({ value, onChange, onStart, onExit, source, error, deck }: {
  deck?: { value: string; onChange: (id: string) => void; onStart: (id: string) => void }
  value: string[]; onChange: (tags: string[]) => void; onStart: (tags: string[]) => void; onExit: () => void; source: LibrarySnapshot | null; error: string | null
}) {
  const selection = source && selectStudyCards(deck ? source.cards.filter(card => source.decks.some(d => d.id === deck.value) && inDeck(card, deck.value, source.decks)) : source.cards, source.data, source.settings, source.meta, deck ? null : value, source.decks)
  const total = selection ? selection.reviews.length + selection.fresh.length : 0
  return <section className="app-container space-y-5 tag-study-page">
    <header className="scope-toolbar" data-tauri-drag-region><button className="study-quiet" onClick={onExit}>{t('‹ 返回我的卡片')}</button>
    <h2 className="text-2xl font-bold">{t(deck ? '按牌组学习' : '按标签学习')}</h2></header>
    <p className="section-copy">{t('仅用于本次学习，不修改默认学习范围。')}</p>
    {error && <p role="alert">{localizedMessage(error)}</p>}
    {!source ? <p role="status">{t('准备中…')}</p> : <div className="app-surface p-5 space-y-5">
      {deck ? <><DeckPicker decks={source.decks} value={deck.value} onChange={deck.onChange} /><p className="section-copy">{t('包含所选牌组及其子牌组。')}</p><p>{t('包含 {0} 张卡片', selection?.matching.length ?? 0)}</p></> : <TagSelector cards={source.cards} value={value} onChange={onChange} />}
      {selection && <div aria-live="polite" className="space-y-2">
        <p>{t('本次可学：待复习 {0} 张 · 新卡 {1} 张', selection.reviews.length, selection.fresh.length)}</p>
        <p className="section-copy">{t('今日新卡剩余额度：{0} 张', selection.budget)}</p>
        {total === 0 && <p>{!deck && !value.length ? t('请至少选择一个标签') : selection.matching.length === 0 ? t(deck ? '没有匹配卡片，请选择其他牌组' : '没有匹配卡片，请选择其他标签') : selection.freshCount > 0 && selection.budget === 0 ? t('今日新卡额度已用完') : t('当前范围暂无待学卡片')}</p>}
      </div>}
      <button className="btn-primary" disabled={total === 0 || !!error} onClick={() => deck ? deck.onStart(deck.value) : onStart(value)}>{t('开始学习 · {0} 张', total)}</button>
    </div>}
  </section>
}

export function DeckStudyPage({ value, onChange, onStart, onExit, source, error }: {
  value: string; onChange: (id: string) => void; onStart: (id: string) => void; onExit: () => void; source: LibrarySnapshot | null; error: string | null
}) {
  return <TagStudyPage value={[]} onChange={() => {}} onStart={() => {}} onExit={onExit} source={source} error={error} deck={{ value, onChange, onStart }} />
}
