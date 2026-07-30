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
    <div className="app-page">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h1 className="text-lg font-bold">
            Vibe <span className="text-brand-600">Word</span>
          </h1>
          <nav className="grid grid-cols-4 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key)
                  bump()
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  tab === t.key
                    ? 'bg-white text-brand-700 shadow-sm'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="app-container">
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
