import { AppSelect } from './AppSelect'
import { DeckPicker } from './DeckEditor'
import { t } from '../lib/i18n'

export function CardOrganization({ deckId, onDeckChange, tags, onTagsChange, availableTags, onManage }: {
  deckId: string
  onDeckChange: (id: string) => void
  tags: string[]
  onTagsChange: (tags: string[]) => void
  availableTags: string[]
  onManage: (view: 'decks' | 'tags') => void
}) {
  return <div className="add-organization">
    <DeckPicker value={deckId} onChange={onDeckChange} onManage={() => onManage('decks')} />
    <div className="deck-picker">
      <div className="deck-picker-select"><span>{t('标签')}</span><AppSelect
        label={t('选择标签')} value="" placeholder={t('选择标签')}
        options={availableTags.filter(tag => !tags.includes(tag)).sort((a, b) => a.localeCompare(b)).map(tag => ({ value: tag, label: tag }))}
        onChange={tag => onTagsChange([...tags, tag])}
      /></div>
      <button type="button" className="btn-secondary" onClick={() => onManage('tags')}>{t('管理标签')}</button>
      <div className="add-selected-tags">{tags.map(tag => <button type="button" className="btn-ghost" key={tag} aria-label={t('移除标签：{0}', tag)} onClick={() => onTagsChange(tags.filter(value => value !== tag))}>{tag} ×</button>)}</div>
    </div>
  </div>
}
