import { WorkspaceToolbar } from './WorkspaceToolbar'
import { StudyScopeEditor } from './StudyScopeEditor'
import { validStudyScope } from '../lib/tags'
import { selectStudyCards } from '../lib/study'
import type { Deck, StudyData } from '../types'
import type { Meta } from '../lib/storage'
import { loadDecks, loadStudyData, loadMeta } from '../lib/storage'
import { AppSelect } from './AppSelect'
import './SettingsPanel.css'
import { SchedulerSettings, type SchedulerSettingsHandle } from './SchedulerSettings'
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
interface Props { onChanged?: () => void }
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

export const SettingsPanel = forwardRef<SettingsHandle, Props>(function SettingsPanel({ onChanged }, ref) {
  const scheduler = useRef<SchedulerSettingsHandle>(null)
  const [schedulerDirty,setSchedulerDirty] = useState(false)
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null)
  const [studyScope, setStudyScope] = useState<StudyScope>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [preview, setPreview] = useState<{ data: StudyData; meta: Meta } | null>(null)
  const theme = useTheme()
  const language = useLanguage()
  const [shortcuts, setShortcuts] = useState(() => normalizeShortcuts(loadShortcuts()))
  const [draftLanguage, setDraftLanguage] = useState<LanguagePreference>(language)
  const [newCardsPerDay, setNewCardsPerDay] = useState(10)
  const selection = preview && selectStudyCards(cards, preview.data, { newCardsPerDay }, preview.meta, studyScope, decks)
  const [llm, setLlm] = useState<LLMConfig>({ baseURL: '', apiKey: '', model: '' })
  const [imageCfg, setImageCfg] = useState<ImageGenConfig>({ baseURL: '', apiKey: '', model: '' })
  const [cloudEnabled, setCloudEnabled] = useState<boolean | null>(null)
  const [baseline, setBaseline] = useState({ limit: 10, studyScope, studyDeckId, llm, image: imageCfg, cloud: cloudEnabled, language, shortcuts })
  const previous = useRef<typeof baseline>()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const pendingLeave = useRef<(() => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dirty = schedulerDirty || loaded && !equal(baseline, { limit: newCardsPerDay, studyScope, studyDeckId, llm, image: imageCfg, cloud: cloudEnabled, language: draftLanguage, shortcuts })
  const busy = useRef(false)

  useEffect(() => {
    let stopped = false
    let request = 0
    async function load() {
      const id = ++request
      const [settings, model, image, cloud, all, deckList, data, meta] = await Promise.all([
        loadSettings(), loadLLMConfig(), loadImageGenConfig(), loadCloudStatus(), allCards(), loadDecks(), loadStudyData({ includeReviews: false }), loadMeta(),
      ])
      if (stopped || id !== request || busy.current) return
      const empty = { baseURL: '', apiKey: '', model: '' }
      const next = { limit: settings.newCardsPerDay, studyScope: settings.studyScope ?? null, studyDeckId: settings.studyDeckId ?? null, llm: model ?? empty, image: image ?? empty, cloud: cloud?.enabled ?? null, language, shortcuts: normalizeShortcuts(loadShortcuts()) }
      setCards(all); setDecks(deckList); setPreview({ data, meta })
      const old = previous.current
      setStudyDeckId(value => !old || value === old.studyDeckId ? next.studyDeckId : value)
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
      if (studyDeckId !== null && !(await loadDecks()).some(d => d.id === studyDeckId)) throw new Error(t('牌组不存在，请重新选择'))
      if (!validStudyScope(studyScope)) throw new Error(t('请补全学习范围'))
      if (!validShortcuts(shortcuts)) throw new Error(t('快捷键不能重复，请为每个操作选择不同的按键'))
      const trim = <T extends LLMConfig | ImageGenConfig>(config: T): T => ({ ...config, baseURL: config.baseURL.trim(), apiKey: config.apiKey.trim(), model: config.model.trim() })
      const next = { limit: newCardsPerDay, studyScope, studyDeckId, llm: trim(llm), image: trim(imageCfg), cloud: cloudEnabled, language: draftLanguage, shortcuts }
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
    <div className="settings-panel">

      <section className="settings-group" aria-labelledby="settings-learning-heading">
      <h2 id="settings-learning-heading" className="settings-group-title">{t('学习与复习')}</h2>
      <fieldset disabled={!loaded || saving} className="min-w-0">
      <section id="study-settings" className="app-surface settings-section settings-study">
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
        <StudyScopeEditor value={studyScope} onChange={value => { setStudyScope(value); setStudyDeckId(null) }} cards={cards} decks={decks} />
        {selection && <div aria-live="polite">
          <p>{t('合计匹配 {0} 张卡片，已去重', selection.matching.length)}</p>
          <p>{t('本次可学：待复习 {0} 张 · 新卡 {1} 张', selection.reviews.length, selection.fresh.length)}</p>
          {selection.matching.length === 0 && <p className="section-copy">{t('当前没有匹配卡片')}</p>}
        </div>}
      </section>
      </fieldset>
      <SchedulerSettings ref={scheduler} onDirty={setSchedulerDirty} />
      </section>
      <fieldset disabled={!loaded || saving} className="settings-sections min-w-0">
      <section className="settings-group" aria-labelledby="settings-interface-heading">
      <h2 id="settings-interface-heading" className="settings-group-title">{t('外观与语言')}</h2>
      <div className="settings-general">
      <section className="app-surface settings-section">
        <div className="settings-heading"><label id="interface-theme-label" htmlFor="interface-theme" className="section-title">{t('外观')}</label></div>
        <AppSelect label={t('外观')} id="interface-theme" value={theme} onChange={setTheme} options={[
          { value: 'system', label: t('跟随系统') },
          { value: 'light', label: t('白天模式') },
          { value: 'dark', label: t('夜间模式') },
        ]} />
        <p className="section-copy">{t('立即生效并自动保存，所有页面使用同一外观。')}</p>
      </section>
      <section className="app-surface settings-section">
        <div className="settings-heading"><label id="interface-language-label" htmlFor="interface-language" className="section-title">{t('语言')}</label><SettingsHelp title={t('语言')}><p>{t('语言仅应用于本机界面，不改变卡片内容。')}</p></SettingsHelp></div>
        <AppSelect label={t('语言')} id="interface-language" value={draftLanguage} onChange={setDraftLanguage} options={[
          { value: 'system', label: t('跟随系统') },
          { value: 'zh-Hans', label: '简体中文' },
          { value: 'en', label: 'English' },
        ]} />
      </section>

      </div>

      </section>
      <section className="settings-group" aria-labelledby="settings-model-heading">
      <h2 id="settings-model-heading" className="settings-group-title">{t('AI 模型')}</h2>
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
      </section>
      <section className="app-surface settings-section">
        <div className="settings-heading justify-between"><h3 className="section-title">{t('快捷键')}</h3><button type="button" className="btn-secondary" onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}>{t('恢复默认')}</button></div>
        <p className="section-copy">{t('仅在本机生效；输入文字时不触发。保存配置后生效。')}</p>
        <div className="settings-shortcuts">{SHORTCUT_ACTIONS.map(({ action, label }) => <label key={action} className="shortcut-setting">
          <span>{t(label)}</span><AppSelect label={t(label)} value={shortcuts[action]} onChange={value => setShortcuts({ ...shortcuts, [action]: value })}
            options={SHORTCUT_KEYS.map(key => ({ value: key, label: t(shortcutLabel(key)) }))} />
        </label>)}</div>
        {!validShortcuts(shortcuts) && <p role="alert" className="text-red-600">{t('快捷键不能重复，请为每个操作选择不同的按键')}</p>}
      </section>
      </fieldset>
      <section className="settings-group settings-cloud" aria-label={t('数据同步')}>
      <h2 className="settings-group-title">{t('数据同步')}</h2>
      <fieldset disabled={!loaded || saving} className="min-w-0">
      {cloudEnabled !== null && <section className="app-surface settings-section">
        <div className="settings-heading"><h3 className="section-title">iCloud</h3><SettingsHelp title="iCloud"><p>{t('固定目录：iCloud Drive / VibeWordSync-v1')}</p><p>{t('关闭后仅使用本地数据，保留已有的 iCloud 文件。')}</p><p>{t('卡片、进度和文字／画图模型配置一起同步，包含 API 地址、模型名和 API Key；API Key 以明文保存在同步文件中。')}</p></SettingsHelp></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={cloudEnabled} onChange={e => setCloudEnabled(e.target.checked)} />{t('将数据同步到 iCloud')}</label>
      </section>}
      </fieldset>
      <div id="settings-cloud-status" />
      </section>
      <WorkspaceToolbar page="settings"><div className="settings-savebar" data-dirty={dirty}>
        <div className="settings-save-status" aria-live="polite">
          {error ? <p role="alert" className="text-red-600">{localizedMessage(error)}</p> : <p>{saving ? t('处理中…') : dirty ? t('有未保存的修改') : saved ? t('已保存') : t('暂无修改')}</p>}
        </div>
        <button className="btn-primary" disabled={!loaded || !dirty || saving} onClick={() => void save()}>{saving ? t('处理中…') : !dirty && saved ? t('已保存') : t('保存配置')}</button>
      </div>
      </WorkspaceToolbar>
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
