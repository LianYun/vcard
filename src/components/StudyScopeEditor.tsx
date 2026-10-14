import { useId, useRef, useState } from 'react'
import type { Card, Deck, StudyScope, StudyScopeRule } from '../types'
import { matchesScopeRule, normalizeStudyScope, validStudyScope } from '../lib/tags'
import { ancestors, deckPath } from '../lib/decks'
import { t } from '../lib/i18n'
import { TagSelector } from './TagSelector'
import './StudyScopeEditor.css'

function RuleEditor({ rule, cards, decks, onChange }: { rule: StudyScopeRule; cards: Card[]; decks: Deck[]; onChange: (rule: StudyScopeRule) => void }) {
  const [query, setQuery] = useState('')
  const [picker, setPicker] = useState<'decks' | 'tags'>('decks')
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const scoped = cards.filter(card => matchesScopeRule(card, { ...rule, tags: null }, decks))
  const names = rule.deckIds?.map(id => decks.find(deck => deck.id === id)?.name ?? `${id} (${t('牌组不存在，请重新选择')})`)
  function open(kind: 'decks' | 'tags') { setPicker(kind); setQuery(''); dialog.current?.showModal() }
  return <>
    <div className="scope-dimension"><strong>{t('牌组')}</strong><div className="scope-chips">
      {names === undefined ? <span>{t('全部牌组')}</span> : names.map((name, index) => <button type="button" className="btn-secondary" key={rule.deckIds![index]} onClick={() => onChange({ ...rule, deckIds: rule.deckIds!.filter((_, i) => i !== index) })}>{name} ×</button>)}
      <button type="button" className="btn-secondary" onClick={() => open('decks')}>{t('选择牌组')}</button>
    </div></div>
    <p className="section-copy">{t('包含所选牌组及其子牌组。')}</p>
    <div className="scope-dimension"><strong>{t('标签')}</strong><div className="scope-chips">
      {rule.tags === null ? <span>{t('全部标签')}</span> : rule.tags.map(tag => <button type="button" className="btn-secondary" key={tag} onClick={() => onChange({ ...rule, tags: rule.tags!.filter(item => item !== tag) })}>{tag || t('未打标签')} ×</button>)}
      <button type="button" className="btn-secondary" onClick={() => open('tags')}>{t('选择标签')}</button>
    </div></div>
    {(rule.deckIds?.length === 0 || rule.tags?.length === 0) && <p role="status">{t('请补全学习范围')}</p>}
    <p className="section-copy">{t('匹配 {0} 张卡片', cards.filter(card => matchesScopeRule(card, rule, decks)).length)}</p>
    <dialog ref={dialog} className="scope-picker app-surface" aria-labelledby={id}>
      <header><h3 id={id}>{t(picker === 'decks' ? '选择牌组' : '选择标签')}</h3><button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>{t('完成')}</button></header>
      {picker === 'decks' ? <>
        <label><input type="checkbox" checked={rule.deckIds === null} onChange={e => onChange({ ...rule, deckIds: e.target.checked ? null : [] })} /> {t('全部牌组')}</label>
        <input type="search" className="app-field" aria-label={t('搜索牌组')} placeholder={t('搜索牌组')} value={query} onChange={e => setQuery(e.target.value)} />
        <div className="scope-options">{[...decks].sort((a, b) => deckPath(a.id, decks).localeCompare(deckPath(b.id, decks))).filter(deck => deckPath(deck.id, decks).toLowerCase().includes(query.toLowerCase())).map(deck => <label key={deck.id} style={{ paddingInlineStart: `${12 + Math.min(ancestors(deck.id, decks).length - 1, 5) * 12}px` }}>
          <input type="checkbox" checked={rule.deckIds?.includes(deck.id) ?? false} onChange={e => onChange({ ...rule, deckIds: e.target.checked ? [...rule.deckIds ?? [], deck.id] : rule.deckIds!.filter(id => id !== deck.id) })} />
          <span>{deckPath(deck.id, decks)}</span>
        </label>)}</div>
      </> : <>
        <label><input type="checkbox" checked={rule.tags === null} onChange={e => onChange({ ...rule, tags: e.target.checked ? null : [] })} /> {t('全部标签')}</label>
        <TagSelector cards={scoped} value={rule.tags ?? []} onChange={tags => onChange({ ...rule, tags })} />
      </>}
    </dialog>
  </>
}

export function StudyScopeEditor({ value, onChange, cards, decks }: { value: StudyScope; onChange: (value: StudyScope) => void; cards: Card[]; decks: Deck[] }) {
  const scope = normalizeStudyScope(value)
  const id = useId()
  return <div className="scope-editor">
    <div className="scope-chips">
      <label><input type="radio" name={id} checked={scope.mode === 'all'} onChange={() => onChange({ version: 2, mode: 'all', rules: [] })} /> {t('全部卡片')}</label>
      <label><input type="radio" name={id} checked={scope.mode === 'custom'} onChange={() => onChange({ version: 2, mode: 'custom', rules: [{ deckIds: [], tags: null }] })} /> {t('自定义范围')}</label>
    </div>
    {scope.mode === 'custom' && <>
      {scope.rules.map((rule, index) => <div key={index}>
        {index > 0 && <p className="scope-or">{t('或者')}</p>}
        <section className="scope-rule" aria-label={t('范围 {0}', index + 1)}>
          <header><h5>{t('范围 {0}', index + 1)}</h5><button type="button" className="study-quiet" disabled={scope.rules.length === 1} onClick={() => onChange({ ...scope, rules: scope.rules.filter((_, i) => i !== index) })}>{t('删除')}</button></header>
          <RuleEditor rule={rule} cards={cards} decks={decks} onChange={next => onChange({ ...scope, rules: scope.rules.map((item, i) => i === index ? next : item) })} />
        </section>
      </div>)}
      <button type="button" className="btn-secondary" onClick={() => onChange({ ...scope, rules: [...scope.rules, { deckIds: [], tags: null }] })}>{t('＋ 添加学习范围')}</button>
      {!validStudyScope(scope) && <p role="status">{t('请补全学习范围')}</p>}
      <p className="section-copy">{t('满足任一范围即可，同一卡片只加入一次。')}</p>
    </>}
  </div>
}
