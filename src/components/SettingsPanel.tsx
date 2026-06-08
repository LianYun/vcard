import { useState } from 'react'
import { loadLLMConfig, loadSettings, saveLLMConfig, saveSettings } from '../lib/storage'
import type { LLMConfig } from '../types'

interface Props {
  onChanged?: () => void
}

export function SettingsPanel({ onChanged }: Props) {
  const [newCardsPerDay, setNewCardsPerDay] = useState<number>(
    () => loadSettings().newCardsPerDay,
  )

  const [llm, setLlm] = useState<LLMConfig>(() => {
    return loadLLMConfig() ?? { baseURL: '', apiKey: '', model: '' }
  })
  const [llmSaved, setLlmSaved] = useState(false)

  function handleSaveStudy(e: React.FormEvent) {
    e.preventDefault()
    saveSettings({ newCardsPerDay: Math.max(0, Math.floor(newCardsPerDay)) })
    onChanged?.()
  }

  function handleSaveLLM(e: React.FormEvent) {
    e.preventDefault()
    saveLLMConfig({
      baseURL: llm.baseURL.trim(),
      apiKey: llm.apiKey.trim(),
      model: llm.model.trim(),
    })
    setLlmSaved(true)
    setTimeout(() => setLlmSaved(false), 2000)
    onChanged?.()
  }

  return (
    <div className="space-y-6">
      {/* Study settings */}
      <form onSubmit={handleSaveStudy} className="space-y-4 rounded-3xl bg-white p-6 shadow-md ring-1 ring-slate-200">
        <h3 className="text-base font-semibold text-slate-800">学习设置</h3>
        <label className="block text-sm font-medium text-slate-700">
          每天新词上限
        </label>
        <input
          type="number"
          min={0}
          max={100}
          value={newCardsPerDay}
          onChange={(e) => setNewCardsPerDay(Number(e.target.value))}
          className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <p className="text-xs text-slate-500">
          控制每天自动引入多少张新词卡。已学过的复习卡片不受此限制。
        </p>
        <button
          type="submit"
          className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-md transition hover:bg-brand-700 active:scale-95"
        >
          保存设置
        </button>
      </form>

      {/* LLM API config */}
      <form onSubmit={handleSaveLLM} className="space-y-4 rounded-3xl bg-white p-6 shadow-md ring-1 ring-slate-200">
        <h3 className="text-base font-semibold text-slate-800">AI 模型配置</h3>
        <p className="text-xs text-slate-500">
          配置 OpenAI 兼容 API 后，添加卡片时可使用 AI 自动生成释义、例句、词源等。
          支持 OpenAI / DeepSeek / 通义千问 / Moonshot / Ollama 等。
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            API 地址
          </label>
          <input
            type="text"
            value={llm.baseURL}
            onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            API Key
          </label>
          <input
            type="password"
            value={llm.apiKey}
            onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
            placeholder="sk-..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            模型名称
          </label>
          <input
            type="text"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            placeholder="gpt-4o-mini / deepseek-chat / qwen-turbo"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-md transition hover:bg-brand-700 active:scale-95"
          >
            保存配置
          </button>
          {llmSaved && (
            <span className="text-sm text-emerald-600">已保存</span>
          )}
        </div>
      </form>
    </div>
  )
}
