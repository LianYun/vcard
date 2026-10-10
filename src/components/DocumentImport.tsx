import { useEffect, useState } from 'react'
import type { ImportedDocument } from '../lib/importTypes'
import { chooseImportDocument, parseImportDocument, supportsDocumentImport, loadLLMConfig, loadImportImage } from '../lib/storage'
import { generationQueue } from '../lib/generationQueue'
import { localizedMessage, t } from '../lib/i18n'
function PageImage({ id, label }: { id: string; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { let alive = true; void loadImportImage(id).then(value => { if (alive) setSrc(value) }).catch(() => {}); return () => { alive = false } }, [id])
  return src ? <img src={src} alt={label} className="max-w-full" /> : null
}
export function DocumentImport({ onAdded, onViewTasks }: { onAdded: () => void; onViewCards: () => void; onViewTasks: () => void }) {
  const [supported, setSupported] = useState(false), [busy, setBusy] = useState(false)
  const [document, setDocument] = useState<ImportedDocument | null>(null), [sections, setSections] = useState<string[]>([])
  const [target, setTarget] = useState(10), [reverse, setReverse] = useState(true), [guidance, setGuidance] = useState('')
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => { void supportsDocumentImport().then(setSupported).catch(e => setError(String(e))) }, [])
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await work() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  async function read(file?: File) {
    const result = file ? await parseImportDocument(file) : await chooseImportDocument()
    if (!result) return
    if ('importedCount' in result) { setMessage(t('已导入或更新 {0} 张卡片', result.importedCount)); onAdded(); return }
    setDocument(result); setSections(result.sections.map(s => s.id)); setMessage('')
  }
  async function submit() {
    if (!document) return
    const selected = { ...document, sections: document.sections.filter(s => sections.includes(s.id)) }
    const config = await loadLLMConfig()
    if (!config?.apiKey || !config.model || !config.baseURL) throw new Error('请先在设置中配置 AI 模型')
    if (selected.sections.some(s => s.imageId) && !config.supportsImages) throw new Error('请在设置中配置支持图片输入的模型，并开启图片输入支持')
    await generationQueue.enqueueDocument(selected, target, reverse, guidance)
    setDocument(null); setMessage(t('已加入任务队列'))
  }
  return <section className="space-y-5">
    {error && <p role="alert" className="status-error">{localizedMessage(error)}</p>}
    {message && <p role="status" className="status-info">{message}</p>}
    <button className="btn-secondary" onClick={onViewTasks}>{t('查看任务队列')}</button>
    {!supported && <p>{t('文档解析需要 Mac 应用。请在 Mac 版的「添加 → 导入文件」中使用。')}</p>}
    {!document ? <div className="import-drop app-surface" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length !== 1) { setError('请一次导入一个文档'); return }; void action(() => read(e.dataTransfer.files[0])) }}>
      <h3>{t('拖入文档，或选择文件')}</h3><p>PDF、DOCX、TXT、Markdown、CSV、JSON、JSONL · 20 MB</p><button className="btn-primary" disabled={busy || !supported} onClick={() => void action(() => read())}>{t(busy ? '准备中…' : '选择文件')}</button><p>{t('规范卡片直接导入；文档 AI 制卡进入任务队列审核。')}</p>
    </div> : <div className="import-config">
      <section className="app-surface p-5"><h3 className="section-title">{document.name}</h3>{document.warnings.map(w => <p key={w}>{localizedMessage(w)}</p>)}<div className="task-actions"><button className="btn-secondary" onClick={() => setSections(document.sections.map(s => s.id))}>{t('全选')}</button><button className="btn-secondary" onClick={() => setSections([])}>{t('取消全选')}</button></div><div className="import-source-list">{document.sections.map(s => <label key={s.id} className="block py-3"><input type="checkbox" checked={sections.includes(s.id)} onChange={e => setSections(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))} /> {s.label}{s.imageId && <PageImage id={s.imageId} label={s.label} />}<p className="whitespace-pre-wrap">{s.text}</p></label>)}</div></section>
      <section className="app-surface p-5 space-y-5"><label className="block">{t('目标词条数（上限 50）')}<input className="app-field" type="number" min={1} max={50} value={target} onChange={e => setTarget(Number(e.target.value))} /></label><label className="block"><input type="checkbox" checked={reverse} onChange={e => setReverse(e.target.checked)} /> {t('生成反向记忆卡片')}</label><label className="block">{t('生成要求')}<textarea className="app-field" rows={5} value={guidance} onChange={e => setGuidance(e.target.value)} /></label><button className="btn-primary" disabled={busy || !sections.length || !Number.isInteger(target) || target < 1 || target > 50} onClick={() => void action(submit)}>{t('提交任务')}</button><button className="btn-secondary" disabled={busy} onClick={() => setDocument(null)}>{t('更换文档')}</button></section>
    </div>}
  </section>
}
