// App shell: tab navigation across Study / Add / Cards / Settings.

import { useState } from 'react'
import { StudyPage } from './components/StudyPage'
import { AddCardForm } from './components/AddCardForm'
import { CardManager } from './components/CardManager'
import { SettingsPanel } from './components/SettingsPanel'
import { StatsBar } from './components/StatsBar'

type Tab = 'study' | 'add' | 'cards' | 'settings'

const TABS: { key: Tab; label: string }[] = [
  { key: 'study', label: '学习' },
  { key: 'add', label: '添加' },
  { key: 'cards', label: '卡片' },
  { key: 'settings', label: '设置' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('study')
  const [refreshKey, setRefreshKey] = useState(0)
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null)
  const bump = () => setRefreshKey((k) => k + 1)

  function jumpToCard(cardId: string) {
    setHighlightCardId(cardId)
    setTab('cards')
    bump()
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">
            Vibe <span className="text-brand-600">Word</span>
          </h1>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key)
                  bump()
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.key
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {tab === 'study' && <StudyPage />}
        {tab === 'add' && <AddCardForm onAdded={bump} onJumpToCard={jumpToCard} />}
        {tab === 'cards' && (
          <div className="space-y-6">
            <StatsBar refreshKey={refreshKey} />
            <CardManager
              refreshKey={refreshKey}
              onChanged={bump}
              highlightCardId={highlightCardId}
              onHighlightConsumed={() => setHighlightCardId(null)}
            />
          </div>
        )}
        {tab === 'settings' && <SettingsPanel onChanged={bump} />}
      </main>
    </div>
  )
}
