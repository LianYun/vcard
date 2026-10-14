import type { Card } from '../types'
import { useRef } from 'react'
import { CardEditor, type EditorRequest } from './CardEditor'

export function AddCardForm({ onAdded, initialDeckId, initialTags, cards, onManage }: { cards: Card[]; onManage: (view: 'decks' | 'tags') => void; initialTags?: string[]; initialDeckId?: string; onAdded?: () => void }) {
  const saved = useRef(onAdded)
  saved.current = onAdded
  // Retain the draft across tab switches and library refreshes.
  const request = useRef<EditorRequest>({ kind: 'create', initialDeckId, initialTags, onSaved: () => saved.current?.() })
  return <CardEditor availableTags={[...new Set(cards.flatMap(card => card.tags ?? []))]} onManage={onManage} request={request.current} targetDeckId={initialDeckId} embedded onClose={() => {}} />
}
