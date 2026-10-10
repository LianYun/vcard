import type { Card } from '../types'
import { t } from '../lib/i18n'
import { useCardEditor } from './CardEditor'
export function AnkiNoteEditor({ card, onSaved }: { card: Card; onSaved?: () => void }) {
  const openEditor = useCardEditor()
  if (!card.anki) return null
  return <button type="button" className="btn-secondary" onClick={e => { e.stopPropagation(); openEditor({ kind: 'card', id: card.id, onSaved }) }}>{t('编辑 Anki 笔记')}</button>
}
