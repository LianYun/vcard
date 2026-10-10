import { SchedulerSettings, type SchedulerSettingsHandle } from './SchedulerSettings'
import { TagSelector } from './TagSelector'
import { allCards } from '../lib/cardStore'
import type { Card, StudyScope } from '../types'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_KEYS, normalizeShortcuts, shortcutLabel, validShortcuts } from '../lib/shortcuts'
import { setTheme, useTheme } from '../lib/theme'
import { localizedMessage, t, useLanguage, setLanguage } from '../lib/i18n'
import { forwardRef, useEffect, useImperativeHandle, useId, useRef, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  loadImageGenConfig, loadLLMConfig, loadSettings, loadCloudStatus,
  savePreferences, loadShortcuts, saveShortcuts, type LanguagePreference,
} from '../lib/storage'
import type { ImageGenConfig, LLMConfig } from '../types'

export interface SettingsHandle { requestLeave: (leave: () => void) => void }
interface Props { onChanged?: () => void; onHelp: () => void }
const native = '__TAURI_INTERNALS__' in window
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function SettingsHelp({ title, children }: { title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  return <>
    <button type="button" className="settings-help" aria-label={`${title} · ${t('帮助')}`} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><span aria-hidden="true">?</span></button>
    <dialog ref={dialog} className="settings-help-dialog app-surface" aria-labelledby={id} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close() } }}>
      <header><h3 id={id} className="section-title">{title}</h3><button type="button" className="settings-close" aria-label={t('关闭')} onClick={() => dialog.current?.close()}>×</button></header>
      <div className="settings-help-copy">{children}</div>
    </dialog>
  </>
}

export const SettingsPanel = forwardRef<SettingsHandle, Props>(function SettingsPanel({ onChanged, onHelp }, ref) {
  const scheduler = useRef<SchedulerSettingsHandle>(null)
  const [schedulerDirty,setSchedulerDirty] = useState(false)
  const [studyScope, setStudyScope] = useState<StudyScope>(null)
  const [cards, setCards] = useState<Card[]>([])
  const theme = useTheme()
  const language = useLanguage()
  const [shortcuts, setShortcuts] = useState(() => normalizeShortcuts(loadShortcuts()))
  const [draftLanguage, setDraftLanguage] = useState<LanguagePreference>(language)
  const [newCardsPerDay, setNewCardsPerDay] = useState(10)
  const [llm, setLlm] = useState<LLMConfig>({ baseURL: '', apiKey: '', model: '' })
  const [imageCfg, setImageCfg] = useState<ImageGenConfig>({ baseURL: '', apiKey: '', model: '' })
  const [cloudEnabled, setCloudEnabled] = useState<boolean | null>(null)
  const [baseline, setBaseline] = useState({ limit: 10, studyScope, llm, image: imageCfg, cloud: cloudEnabled, language, shortcuts })
  const previous = useRef<typeof baseline>()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const pendingLeave = useRef<(() => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dirty = schedulerDirty || loaded && !equal(baseline, { limit: newCardsPerDay, studyScope, llm, image: imageCfg, cloud: cloudEnabled, language: draftLanguage, shortcuts })
  const busy = useRef(false)

  useEffect(() => {
    let stopped = false
    let request = 0
    async function load() {
      const id = ++request
      const [settings, model, image, cloud, all] = await Promise.all([
        loadSettings(), loadLLMConfig(), loadImageGenConfig(), loadCloudStatus(), allCards(),
      ])
      if (stopped || id !== request || busy.current) return
      const empty = { baseURL: '', apiKey: '', model: '' }
      const next = { limit: settings.newCardsPerDay, studyScope: settings.studyScope ?? null, llm: model ?? empty, image: image ?? empty, cloud: cloud?.enabled ?? null, language, shortcuts: normalizeShortcuts(loadShortcuts()) }
      setCards(all)
      const old = previous.current
      setStudyScope(value => !old || equal(value, old.studyScope) ? next.studyScope : value)
      setNewCardsPerDay(value => !old || value === old.limit ? next.limit : value)
      setLlm(value => !old || equal(value, old.llm) ? next.llm : value)
      setImageCfg(value => !old || equal(value, old.image) ? next.image : value)
      setCloudEnabled(value => !old || value === old.cloud ? next.cloud : value)
      setDraftLanguage(value => !old || value === old.language ? next.language : value)
      setShortcuts(value => !old || equal(value, old.shortcuts) ? next.shortcuts : value)
      previous.current = next
      setBaseline(next)
      setLoaded(true)
      setError('')
    }
    const refresh = () => { void load().catch(err => { if (!stopped) setError(String(err)) }) }
    refresh()
    window.addEventListener('vibe-library-changed', refresh)
    return () => { stopped = true; window.removeEventListener('vibe-library-changed', refresh) }
  }, [language])

  function requestLeave(leave: () => void) {
    if (busy.current) return
    if (!dirty) { leave(); return }
    pendingLeave.current = leave
    setLeaving(true)
  }
  useImperativeHandle(ref, () => ({ requestLeave }))
  useEffect(() => { if (leaving) dialog.current?.showModal(); else dialog.current?.close() }, [leaving])
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  useEffect(() => {
    if (!native) return
    void invoke('set_settings_dirty', { dirty }).catch(err => setError(String(err)))
    return () => { void invoke('set_settings_dirty', { dirty: false }).catch(() => {}) }
  }, [dirty])
  const leaveHandler = useRef(requestLeave)
  leaveHandler.current = requestLeave
  useEffect(() => {
    if (!native) return
    let disposed = false
    let stop: (() => void) | undefined
    const subscription = listen('vibe-exit-requested', () => {
      leaveHandler.current(() => { void invoke('finish_exit').catch(err => setError(String(err))) })
    })
    void subscription.then(unlisten => { if (disposed) unlisten(); else stop = unlisten }).catch(err => setError(String(err)))
    return () => { disposed = true; stop?.() }
  }, [])

  async function save(): Promise<boolean> {
    if (busy.current) return false
    busy.current = true; setSaving(true); setError(''); setSaved(false)
    try {
      if (!Number.isInteger(newCardsPerDay) || newCardsPerDay < 0 || newCardsPerDay > 100) throw new Error(t('每天新词上限必须是 0 到 100 的整数'))
      if (studyScope !== null && !studyScope.length) throw new Error(t('请至少选择一个标签'))
      if (!validShortcuts(shortcuts)) throw new Error(t('快捷键不能重复，请为每个操作选择不同的按键'))
      const trim = <T extends LLMConfig | ImageGenConfig>(config: T): T => ({ ...config, baseURL: config.baseURL.trim(), apiKey: config.apiKey.trim(), model: config.model.trim() })
      const next = { limit: newCardsPerDay, studyScope, llm: trim(llm), image: trim(imageCfg), cloud: cloudEnabled, language: draftLanguage, shortcuts }
      if(!await scheduler.current?.save()) return false
      await savePreferences(next)
      saveShortcuts(shortcuts)
      setLanguage(draftLanguage)
      setLlm(next.llm); setImageCfg(next.image); setBaseline(next); previous.current = next; setSaved(true)
      onChanged?.()
      return true
    } catch (err) { setError(String(err)); return false }
    finally { busy.current = false; setSaving(false) }
  }
  function finishLeave() {
    setLeaving(false)
    const leave = pendingLeave.current
    pendingLeave.current = null
    leave?.()
  }

  return (
    <div className="settings-panel space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2"><h2 className="text-2xl font-bold">{t('设置')}</h2><SettingsHelp title={t('帮助')}><button type="button" className="btn-secondary" onClick={onHelp}>{t('帮助与导入格式')}</button></SettingsHelp></div>
        <button className="btn-primary" disabled={!loaded || !dirty || saving} onClick={() => void save()}>{saving ? t('处理中…') : t('保存配置')}</button>
      </div>
      {error && <p role="alert" className="text-red-600">{localizedMessage(error)}</p>}
      {saved && !dirty && <p role="status" className="status-success">{t('已保存')}</p>}
      <SchedulerSettings ref={scheduler} onDirty={setSchedulerDirty} />
      <fieldset disabled={!loaded || saving} className="settings-sections min-w-0">
      <div className="settings-general">
      <section className="app-surface settings-section">
        <div className="settings-heading"><label htmlFor="interface-theme" className="section-title">{t('外观')}</label></div>
        <select id="interface-theme" className="app-field browse-select" value={theme} onChange={e => setTheme(e.target.value === 'system' ? 'system' : e.target.value === 'dark' ? 'dark' : 'light')}>
          <option value="system">{t('跟随系统')}</option>
          <option value="light">{t('白天模式')}</option>
          <option value="dark">{t('夜间模式')}</option>
        </select>
        <p className="section-copy">{t('立即生效并自动保存，所有页面使用同一外观。')}</p>
      </section>
      {cloudEnabled !== null && <section className="app-surface settings-section">
        <div className="settings-heading"><h3 className="section-title">iCloud</h3><SettingsHelp title="iCloud"><p>{t('固定目录：iCloud Drive / VibeWordSync-v1')}</p><p>{t('关闭后仅使用本地数据，保留已有的 iCloud 文件。')}</p><p>{t('卡片、进度和文字／画图模型配置一起同步，包含 API 地址、模型名和 API Key；API Key 以明文保存在同步文件中。')}</p></SettingsHelp></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={cloudEnabled} onChange={e => setCloudEnabled(e.target.checked)} />{t('将数据同步到 iCloud')}</label>
      </section>}
      <section className="app-surface settings-section">
        <div className="settings-heading"><label htmlFor="interface-language" className="section-title">{t('语言')}</label><SettingsHelp title={t('语言')}><p>{t('语言仅应用于本机界面，不改变卡片内容。')}</p></SettingsHelp></div>
        <select id="interface-language" className="app-field browse-select" value={draftLanguage} onChange={e => setDraftLanguage(e.target.value as LanguagePreference)}>
          <option value="system">{t('跟随系统')}</option>
          <option value="zh-Hans">简体中文</option>
          <option value="en">English</option>
        </select>
      </section>
      <section id="study-settings" className="app-surface settings-section">
        <div className="settings-heading"><h3 className="section-title">{t("学习设置")}</h3><SettingsHelp title={t("学习设置")}><p>{t("控制每天自动引入多少张新词卡。已学过的复习卡片不受此限制。")}</p></SettingsHelp></div>
        <label htmlFor="daily-limit" className="block text-sm font-semibold text-slate-700">{t("每天新词上限")}</label>
        <input
          id="daily-limit"
          type="number"
          min={0}
          max={100}
          value={newCardsPerDay}
          onChange={(e) => setNewCardsPerDay(Number(e.target.value))}
          className="app-field w-32"
        />
        <h4 className="font-semibold">{t('默认学习范围')}</h4>
        <p className="section-copy">{t('点击「开始学习」时使用此范围，下次开始生效。')}</p>
        <div className="flex flex-wrap gap-4">
          <label><input type="radio" name="study-scope" checked={studyScope === null} onChange={() => setStudyScope(null)} /> {t('全部卡片')}</label>
          <label><input type="radio" name="study-scope" checked={studyScope !== null} onChange={() => setStudyScope([])} /> {t('指定标签')}</label>
        </div>
        {studyScope !== null && <TagSelector cards={cards} value={studyScope} onChange={setStudyScope} />}
        {studyScope?.length === 0 && <p role="status">{t('请至少选择一个标签')}</p>}
      </section>
      </div>

      <div className="settings-models">
      <section className="app-surface settings-section">
        <div className="settings-heading"><h3 className="section-title">{t("AI 模型配置")}</h3><SettingsHelp title={t("AI 模型配置")}><p>{t("配置 OpenAI 兼容 API 后，添加卡片时可使用 AI 自动生成释义、例句、词源等。 支持 OpenAI / DeepSeek / 通义千问 / Moonshot / Ollama 等。")}</p></SettingsHelp></div>

        <div>
          <label htmlFor="text-url" className="mb-1 block text-sm font-semibold text-slate-700">{t("API 地址")}</label>
          <input id="text-url"
            type="text"
            value={llm.baseURL}
            onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="app-field"
          />
        </div>

        <div>
          <label htmlFor="text-key" className="mb-1 block text-sm font-semibold text-slate-700">API Key</label>
          <input id="text-key"
            type="password"
            value={llm.apiKey}
            onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
            placeholder="sk-..."
            className="app-field"
          />
        </div>

        <div>
          <label htmlFor="text-model" className="mb-1 block text-sm font-semibold text-slate-700">{t("模型名称")}</label>
          <input id="text-model"
            type="text"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            placeholder="gpt-4o-mini / deepseek-chat / qwen-turbo"
            className="app-field"
          />
        </div>

        <div className="settings-toggle-row"><label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={llm.supportsImages === true} onChange={e => setLlm({ ...llm, supportsImages: e.target.checked })} />
          {t('此模型支持图片输入（文档图文分析必需）')}
        </label>
        <SettingsHelp title={t('此模型支持图片输入（文档图文分析必需）')}><p>{t('请确认模型支持 image_url 消息；此选项是能力声明，不会自动检测或升级模型。')}</p></SettingsHelp></div>

      </section>

      <section className="app-surface settings-section">
        <div className="settings-heading"><h3 className="section-title">{t("画图模型配置（可选）")}</h3><SettingsHelp title={t("画图模型配置（可选）")}><p>{t("配置后，AI 生成卡片时会用例句改写为画面描述并生成一张配图，嵌入到「英→中」卡片正面。 留空则不生成图片。支持 OpenAI DALL·E 及任何兼容 /images/generations 端点的服务商。")}</p></SettingsHelp></div>

        <div>
          <label htmlFor="image-url" className="mb-1 block text-sm font-semibold text-slate-700">{t("API 地址")}</label>
          <input id="image-url"
            type="text"
            value={imageCfg.baseURL}
            onChange={(e) => setImageCfg({ ...imageCfg, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="app-field"
          />
        </div>

        <div>
          <label htmlFor="image-key" className="mb-1 block text-sm font-semibold text-slate-700">API Key</label>
          <input id="image-key"
            type="password"
            value={imageCfg.apiKey}
            onChange={(e) => setImageCfg({ ...imageCfg, apiKey: e.target.value })}
            placeholder="sk-..."
            className="app-field"
          />
        </div>

        <div>
          <label htmlFor="image-model" className="mb-1 block text-sm font-semibold text-slate-700">{t("模型名称")}</label>
          <input id="image-model"
            type="text"
            value={imageCfg.model}
            onChange={(e) => setImageCfg({ ...imageCfg, model: e.target.value })}
            placeholder="dall-e-3 / flux.1-dev"
            className="app-field"
          />
        </div>

      </section>
      </div>
      <section className="app-surface settings-section">
        <div className="settings-heading justify-between"><h3 className="section-title">{t('快捷键')}</h3><button type="button" className="btn-secondary" onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}>{t('恢复默认')}</button></div>
        <p className="section-copy">{t('仅在本机生效；输入文字时不触发。保存配置后生效。')}</p>
        <div className="settings-shortcuts">{SHORTCUT_ACTIONS.map(({ action, label }) => <label key={action} className="shortcut-setting">
          <span>{t(label)}</span><select aria-label={t(label)} className="app-field browse-select" value={shortcuts[action]} onChange={event => setShortcuts({ ...shortcuts, [action]: event.target.value })}>
            {SHORTCUT_KEYS.map(key => <option key={key} value={key}>{t(shortcutLabel(key))}</option>)}
          </select>
        </label>)}</div>
        {!validShortcuts(shortcuts) && <p role="alert" className="text-red-600">{t('快捷键不能重复，请为每个操作选择不同的按键')}</p>}
      </section>
      </fieldset>
      <dialog ref={dialog} onCancel={event => { event.preventDefault(); setLeaving(false); pendingLeave.current = null }} className="app-surface w-full max-w-md p-6 backdrop:bg-slate-900/40" aria-labelledby="unsaved-title">
        <h3 id="unsaved-title" className="section-title">{t('有未保存的配置')}</h3>
        <p className="section-copy mt-3">{t('离开前要保存配置吗？')}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button className="btn-secondary" disabled={saving} onClick={() => { setLeaving(false); pendingLeave.current = null }}>{t('继续编辑')}</button>
          <button className="btn-secondary" disabled={saving} onClick={finishLeave}>{t('放弃修改')}</button>
          <button className="btn-primary" disabled={saving} onClick={async () => { if (await save()) finishLeave() }}>{t('保存并离开')}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-red-600">{localizedMessage(error)}</p>}
      </dialog>
    </div>
  )
})
