import { useState } from 'react'
import type { Card, Deck, StudyScope } from '../types'
import { matchesStudyScope, normalizeStudyTags, normalizeStudyScope, normalizeTags } from '../lib/tags'
import { t } from '../lib/i18n'

export function scopeLabel(scope: StudyScope, decks: Deck[] = []): string {
  const value = normalizeStudyScope(scope)
  if (value.mode === 'all') return t('全部卡片')
  if (!value.rules.length) return t('请补全学习范围')
  return value.rules.map(rule => `${rule.deckIds === null ? t('全部牌组') : rule.deckIds.map(id => decks.find(deck => deck.id === id)?.name ?? id).join('、')}：${rule.tags === null ? t('全部标签') : rule.tags.map(tag => tag || t('未打标签')).join('、') || t('尚未选择标签')}`).join('；')
}

export function TagSelector({ cards, value, onChange }: { cards: Card[]; value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState('')
  const tags = [...new Set(['', ...cards.flatMap(card => normalizeTags(card.tags)), ...value])].sort((a, b) => a.localeCompare(b))
  return <div className="tag-selector space-y-3">
    <input type="search" className="app-field w-full" aria-label={t('搜索标签')} placeholder={t('搜索标签')} value={query} onChange={e => setQuery(e.target.value)} />
    <div className="tag-options" role="group" aria-label={t('选择学习标签')}>
      {tags.filter(tag => (tag || t('未打标签')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(tag => {
        const count = cards.filter(card => matchesStudyScope(card, [tag])).length
        return <label className="tag-option" key={tag}>
          <input type="checkbox" checked={value.includes(tag)} onChange={e => onChange(normalizeStudyTags(e.target.checked ? [...value, tag] : value.filter(item => item !== tag))!)} />
          <span>{tag || t('未打标签')}</span><small>{count}</small>
        </label>
      })}
    </div>
    <p className="section-copy">{t('匹配任意一个所选标签即可，同一卡片只学习一次。')}</p>
    <div className="flex flex-wrap items-center gap-2">
      {value.map(tag => <button type="button" className="btn-secondary" key={tag} aria-label={t('移除标签：{0}', tag || t('未打标签'))} onClick={() => onChange(value.filter(item => item !== tag))}>{tag || t('未打标签')} ×</button>)}
      {value.length > 0 && <button type="button" className="study-quiet" onClick={() => onChange([])}>{t('清空')}</button>}
    </div>
    <p role="status">{t('已选择 {0} 个标签，包含 {1} 张卡片', value.length, cards.filter(card => matchesStudyScope(card, value)).length)}</p>
  </div>
}

export function ScopeSummary({ scope, decks = [] }: { scope: StudyScope; decks?: Deck[] }) {
  const value = normalizeStudyScope(scope)
  const label = scopeLabel(scope, decks)
  return value.rules.length > 2 ? <details><summary>{t('{0} 个学习范围', value.rules.length)}</summary><span>{label}</span></details> : <span>{label}</span>
}
