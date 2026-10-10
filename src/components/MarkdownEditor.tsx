import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react'
import { defaultValueCtx, Editor, rootCtx, editorViewOptionsCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark'
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm'
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { Plugin } from '@milkdown/kit/prose/state'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { callCommand, insert, replaceAll, $prose } from '@milkdown/kit/utils'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { t } from '../lib/i18n'
import './MarkdownEditor.css'
import { audioMarkdown, audioHTMLView } from '../lib/editorAudio'

interface Props { value: string; onChange: (md: string) => void; label?: string }

function MilkdownInner({ value, onChange, label }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const current = useRef(value)
  const host = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [selection, setSelection] = useState<{ top: number; left: number } | null>(null)
  const openMenu = () => { setQuery(''); setActive(0); setMenu(true); setSelection(null) }
  const openMenuRef = useRef(openMenu)
  openMenuRef.current = openMenu
  const { get, loading } = useEditor(root => Editor.make()
    .config(ctx => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, value)
      ctx.update(editorViewOptionsCtx, options => ({ ...options, attributes: { role: 'textbox', 'aria-label': label ?? 'Markdown', 'aria-multiline': 'true' },
        handleKeyDown: (view, event) => {
          if (event.key === '/' && !event.isComposing && view.state.selection.empty && view.state.selection.$from.parent.content.size === 0) {
            event.preventDefault(); openMenuRef.current(); return true
          }
          return false
        },
      }))
    }).use(commonmark).use(gfm).use(audioMarkdown).use(audioHTMLView).use(history).use(clipboard)
    .use($prose(ctx => new Plugin({ view: () => ({ update: (view, previous) => {
      if (view.state.doc.eq(previous.doc)) return
      const md = ctx.get(serializerCtx)(view.state.doc)
      if (md !== current.current) { current.current = md; onChangeRef.current(md) }
    } }) }))), [])

  useEffect(() => {
    if (!loading && current.current !== value) {
      current.current = value
      get()?.action(replaceAll(value))
    }
  }, [value, loading, get])

  const actions: [string, (editor: Editor) => void][] = [
    ['粗体', e => e.action(callCommand(toggleStrongCommand.key))],
    ['斜体', e => e.action(callCommand(toggleEmphasisCommand.key))],
    ['删除线', e => e.action(callCommand(toggleStrikethroughCommand.key))],
    ['标题', e => e.action(callCommand(wrapInHeadingCommand.key, 2))],
    ['无序列表', e => e.action(callCommand(wrapInBulletListCommand.key))],
    ['有序列表', e => e.action(callCommand(wrapInOrderedListCommand.key))],
    ['引用', e => e.action(callCommand(wrapInBlockquoteCommand.key))],
    ['代码块', e => e.action(callCommand(createCodeBlockCommand.key))],
    ['表格', e => e.action(callCommand(insertTableCommand.key, { row: 3, col: 2 }))],
    ['任务列表', e => e.action(insert('- [ ] ' + t('待办事项')))],
    ['链接', e => e.action(insert('[' + t('链接文字') + '](https://example.com)'))],
    ['图片', e => e.action(insert('![' + t('图片说明') + '](https://example.com/image.png)'))],
    ['撤销', e => e.action(callCommand(undoCommand.key))],
    ['重做', e => e.action(callCommand(redoCommand.key))],
  ]
  useEffect(() => {
    const update = () => {
      const selected = window.getSelection()
      const element = host.current
      if (!element || !selected || selected.isCollapsed || !element.querySelector('.editor')?.contains(selected.anchorNode) || !element.querySelector('.editor')?.contains(selected.focusNode)) {
        setSelection(null); return
      }
      const rect = selected.getRangeAt(0).getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      setSelection({ top: Math.max(0, rect.top - bounds.top - 44), left: Math.max(8, Math.min(rect.left - bounds.left, bounds.width - 170)) })
    }
    document.addEventListener('selectionchange', update)
    const dismiss = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('pointerdown', dismiss) }
  }, [])

  useEffect(() => {
    host.current?.querySelector('.document-command-items .is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, query, menu])

  const run = (action: (editor: Editor) => void) => {
    const editor = get()
    if (editor) { action(editor); editor.action(ctx => ctx.get(editorViewCtx).focus()) }
    setMenu(false)
  }
  const symbols = ['B', 'I', 'S', 'H₂', '☷', '1.', '❝', '</>', '▦', '☑', '↗', '▧', '↶', '↷']
  const filtered = actions.map(([name, action], index) => ({ name, action, index })).filter(item => t(item.name).toLowerCase().includes(query.toLowerCase()))
  return <div className="document-editor-inner" ref={host} onKeyDown={event => {
    if (event.key === 'Escape') { setMenu(false); setSelection(null); get()?.action(ctx => ctx.get(editorViewCtx).focus()) }
  }}>
    <div className="document-insert-row">
      <button type="button" className="document-insert" disabled={loading} aria-expanded={menu} onMouseDown={e => e.preventDefault()} onClick={() => menu ? setMenu(false) : openMenu()}><span aria-hidden="true">＋</span> {t('插入内容')}</button>
      <span className="document-shortcut">{t('支持 Markdown 快捷输入')}</span>
    </div>
    {menu && <div className="document-command-menu">
      <input autoFocus className="document-command-search" aria-label={t('搜索格式')} placeholder={t('搜索格式…')} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length)) }
        if (event.key === 'Enter') { event.preventDefault(); const item = filtered[active]; if (item) run(item.action) }
      }} />
      <div className="document-command-items" role="group" aria-label={t('格式工具栏')}>
        {filtered.map((item, index) => <button type="button" key={item.name} className={index === active ? 'is-active' : ''} onMouseDown={e => e.preventDefault()} onClick={() => run(item.action)}><span className="document-command-icon" aria-hidden="true">{symbols[item.index]}</span><span>{t(item.name)}</span></button>)}
        {!filtered.length && <p>{t('没有匹配的格式')}</p>}
      </div>
      <div className="document-command-hint">{t('↑↓ 选择 · Enter 插入 · Esc 关闭')}</div>
    </div>}
    {selection && !menu && <div className="document-selection" style={selection} role="toolbar" aria-label={t('选中文字格式')}>
      {actions.slice(0, 3).map(([name, action], index) => <button type="button" key={name} title={t(name)} aria-label={t(name)} onMouseDown={e => e.preventDefault()} onClick={() => run(action)}>{symbols[index]}</button>)}
    </div>}
    <div data-placeholder={t('开始书写，或输入 / 插入内容…')} className={`document-writing prose prose-sm prose-slate max-w-none ${!value.trim() ? 'is-empty' : ''}`}><Milkdown /></div>
  </div>
}

export function MarkdownEditor(props: Props) {
  const [mode, setMode] = useState<'edit' | 'source' | 'preview'>('edit')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = root.current
    const source = () => setMode('source')
    element?.addEventListener('editor-audio-source', source)
    return () => element?.removeEventListener('editor-audio-source', source)
  }, [])
  return <div ref={root} className="milkdown-wrap document-editor">
    <div className="document-editor-header">
      <span className="document-editor-caption">{t('自由书写')}</span>
      <div className="document-modes" aria-label={t('编辑模式')}>{(['edit', 'source', 'preview'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>{t({ edit: '编辑', source: '源码', preview: '预览' }[item])}</button>)}</div>
    </div>
    {mode === 'edit' && <MilkdownProvider><MilkdownInner {...props} /></MilkdownProvider>}
    {mode === 'source' && <textarea aria-label={`${props.label ?? 'Markdown'} ${t('源码')}`} className="document-source" placeholder={t('在这里输入 Markdown…')} value={props.value} onChange={e => props.onChange(e.target.value)} spellCheck={false} />}
    {mode === 'preview' && <Markdown content={props.value || t('暂无内容')} className="document-preview" />}
  </div>
}
