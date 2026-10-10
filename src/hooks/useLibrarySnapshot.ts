import { useEffect, useState } from 'react'
import { allCards } from '../lib/cardStore'
import { loadDecks, loadMeta, loadSettings, loadStudyData } from '../lib/storage'
import { schedule } from '../lib/scheduler'
import { available } from '../lib/study'
import { todayKey } from '../lib/date'

async function readSnapshot() {
  const [cards, data, settings, decks, meta] = await Promise.all([
    allCards(), loadStudyData({ includeReviews: false }), loadSettings(), loadDecks(), loadMeta(),
  ])
  const result = schedule(cards.filter(card => available(data.controls[card.id])), data.progress, settings, meta)
  return { cards, data, settings, decks, stats: {
    due: result.dueReviews.length, newCards: result.newCards.length, total: cards.length,
  } }
}
export type StudyDetailsSnapshot = Pick<Awaited<ReturnType<typeof readSnapshot>>, 'cards' | 'data'>
export type LibrarySnapshot = Awaited<ReturnType<typeof readSnapshot>>

// Owned by App so navigation never discards the last successful snapshot.
export function useLibrarySnapshot(refreshKey: number) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [history, setHistory] = useState<StudyDetailsSnapshot | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let day = todayKey()
    const invalidate = () => setRevision(value => value + 1)
    const checkDay = () => {
      const next = todayKey()
      if (next !== day) { day = next; invalidate() }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('vibe-word:')) invalidate()
    }
    const timer = window.setInterval(checkDay, 30_000)
    window.addEventListener('focus', checkDay)
    window.addEventListener('storage', onStorage)
    window.addEventListener('vibe-library-changed', invalidate)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', checkDay)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('vibe-library-changed', invalidate)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    // Coalesce an event and its mutation callback, including StrictMode setup.
    const timer = setTimeout(() => {
      void readSnapshot().then(value => {
        if (!cancelled) { setSnapshot(value); setError(null) }
      }).catch(reason => { if (!cancelled) setError(String(reason)) })
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [refreshKey, revision])
  useEffect(() => {
    if (!snapshot) return
    let cancelled = false
    // Prefetch after the lightweight home snapshot; never delay today's counts.
    const timer = setTimeout(() => {
      void loadStudyData().then(data => {
        if (!cancelled) {
          setHistory({ cards: snapshot.cards, data })
          setHistoryError(null)
        }
      }).catch(reason => { if (!cancelled) setHistoryError(String(reason)) })
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [snapshot])
  return { snapshot, error, history, historyError }
}
