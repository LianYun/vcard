import { useEffect, useState } from 'react'
import {
  loadImageGenConfig,
  loadLLMConfig,
  loadSettings,
  saveImageGenConfig,
  saveLLMConfig,
  saveSettings,
} from '../lib/storage'
import type { ImageGenConfig, LLMConfig } from '../types'

interface Props {
  onChanged?: () => void
}

export function SettingsPanel({ onChanged }: Props) {
  const [newCardsPerDay, setNewCardsPerDay] = useState(10)
  const [llm, setLlm] = useState<LLMConfig>({ baseURL: '', apiKey: '', model: '' })
  const [llmSaved, setLlmSaved] = useState(false)
  const [imageCfg, setImageCfg] = useState<ImageGenConfig>({ baseURL: '', apiKey: '', model: '' })
  const [imageSaved, setImageSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const [settings, llmCfg, imageCfg] = await Promise.all([
        loadSettings(),
        loadLLMConfig(),
        loadImageGenConfig(),
      ])
      setNewCardsPerDay(settings.newCardsPerDay)
      if (llmCfg) setLlm(llmCfg)
      if (imageCfg) setImageCfg(imageCfg)
      setLoaded(true)
    }
    load()
  }, [])

  async function handleSaveStudy(e: React.FormEvent) {
    e.preventDefault()
    await saveSettings({ newCardsPerDay: Math.max(0, Math.floor(newCardsPerDay)) })
    onChanged?.()
  }

  async function handleSaveLLM(e: React.FormEvent) {
    e.preventDefault()
    await saveLLMConfig({
      baseURL: llm.baseURL.trim(),
      apiKey: llm.apiKey.trim(),
      model: llm.model.trim(),
    })
    setLlmSaved(true)
    setTimeout(() => setLlmSaved(false), 2000)
    onChanged?.()
  }

  async function handleSaveImage(e: React.FormEvent) {
    e.preventDefault()
    // Treat an all-empty submission as "disable image generation" — still save
    // so loadImageGenConfig() returns null and the queue skips the image step.
    await saveImageGenConfig({
      baseURL: imageCfg.baseURL.trim(),
      apiKey: imageCfg.apiKey.trim(),
      model: imageCfg.model.trim(),
    })
    setImageSaved(true)
    setTimeout(() => setImageSaved(false), 2000)
    onChanged?.()
  }

  if (!loaded) return null

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveStudy} className="app-surface space-y-4 p-5 sm:p-6">
        <h3 className="section-title">学习设置</h3>
        <label className="block text-sm font-semibold text-slate-700">
          每天新词上限
        </label>
        <input
          type="number"
          min={0}
          max={100}
          value={newCardsPerDay}
          onChange={(e) => setNewCardsPerDay(Number(e.target.value))}
          className="app-field w-32"
        />
        <p className="section-copy">
          控制每天自动引入多少张新词卡。已学过的复习卡片不受此限制。
        </p>
        <button
          type="submit"
          className="btn-primary"
        >
          保存设置
        </button>
      </form>

      <form onSubmit={handleSaveLLM} className="app-surface space-y-4 p-5 sm:p-6">
        <h3 className="section-title">AI 模型配置</h3>
        <p className="section-copy">
          配置 OpenAI 兼容 API 后，添加卡片时可使用 AI 自动生成释义、例句、词源等。
          支持 OpenAI / DeepSeek / 通义千问 / Moonshot / Ollama 等。
        </p>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">API 地址</label>
          <input
            type="text"
            value={llm.baseURL}
            onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="app-field"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">API Key</label>
          <input
            type="password"
            value={llm.apiKey}
            onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
            placeholder="sk-..."
            className="app-field"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">模型名称</label>
          <input
            type="text"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            placeholder="gpt-4o-mini / deepseek-chat / qwen-turbo"
            className="app-field"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn-primary"
          >
            保存配置
          </button>
          {llmSaved && <span className="status-success">已保存</span>}
        </div>
      </form>

      <form onSubmit={handleSaveImage} className="app-surface space-y-4 p-5 sm:p-6">
        <h3 className="section-title">画图模型配置（可选）</h3>
        <p className="section-copy">
          配置后，AI 生成卡片时会用例句改写为画面描述并生成一张配图，嵌入到「英→中」卡片正面。
          留空则不生成图片。支持 OpenAI DALL·E 及任何兼容 /images/generations 端点的服务商。
        </p>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">API 地址</label>
          <input
            type="text"
            value={imageCfg.baseURL}
            onChange={(e) => setImageCfg({ ...imageCfg, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="app-field"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">API Key</label>
          <input
            type="password"
            value={imageCfg.apiKey}
            onChange={(e) => setImageCfg({ ...imageCfg, apiKey: e.target.value })}
            placeholder="sk-..."
            className="app-field"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">模型名称</label>
          <input
            type="text"
            value={imageCfg.model}
            onChange={(e) => setImageCfg({ ...imageCfg, model: e.target.value })}
            placeholder="dall-e-3 / flux.1-dev"
            className="app-field"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn-primary"
          >
            保存配置
          </button>
          {imageSaved && <span className="status-success">已保存</span>}
        </div>
      </form>
    </div>
  )
}
