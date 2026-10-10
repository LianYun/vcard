import { $remark, $view } from '@milkdown/kit/utils'
import { closeHistory } from '@milkdown/kit/prose/history'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import { loadMedia } from './storage'
import { t } from './i18n'
import { mountAudioPlayer } from './audioPlayer'

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
export const isAudioHTML = (value: string) => /^\s*<audio\b(?:(?!<\/audio\s*>)[\s\S])*<\/audio\s*>\s*$/i.test(value)

/** Inline HTML arrives as separate opening/source/closing nodes. Merge only a
 * complete audio element using original source offsets, keeping its bytes intact. */
export function mergeAudioNodes(tree: MarkdownNode, source: string) {
  if (!tree.children) return
  const children = tree.children
  for (let i = 0; i < children.length; i++) {
    const first = children[i]
    if (first.type === 'html' && /^\s*<audio\b/i.test(first.value ?? '')) {
      const raw = first.value ?? ''
      const matches = [...raw.matchAll(/<audio\b[\s\S]*?<\/audio\s*>/gi)]
      if (matches.length > 1 && !raw.replace(/<audio\b[\s\S]*?<\/audio\s*>/gi, '').trim()) {
        const nodes: MarkdownNode[] = []
        let offset = 0
        for (const match of matches) {
          if (match.index! > offset) nodes.push({ type: 'text', value: raw.slice(offset, match.index) })
          nodes.push({ type: 'html', value: match[0] })
          offset = match.index! + match[0].length
        }
        if (offset < raw.length) nodes.push({ type: 'text', value: raw.slice(offset) })
        if (tree.type === 'paragraph') { children.splice(i, 1, ...nodes); i += nodes.length - 1 }
        else children[i] = { type: 'paragraph', children: nodes }
        continue
      }
    }
    if (first.type === 'html' && /^\s*<audio\b/i.test(first.value ?? '') && !isAudioHTML(first.value ?? '')) {
      for (let j = i + 1; j < children.length; j++) {
        const last = children[j]
        if (last.type !== 'html' || !/<\/audio\s*>\s*$/i.test(last.value ?? '')) continue
        const start = first.position?.start.offset, end = last.position?.end.offset
        if (start !== undefined && end !== undefined) {
          const raw = source.slice(start, end)
          if (isAudioHTML(raw)) children.splice(i, j - i + 1, { type: 'html', value: raw, position: { start: first.position!.start, end: last.position!.end } })
        }
        break
      }
    }
    mergeAudioNodes(children[i], source)
  }
}

export const audioMarkdown = $remark('editor-audio', () => () => (tree, file) => {
  mergeAudioNodes(tree as MarkdownNode, String(file.value))
})

/** Keep original HTML in the existing html node; only its editor view changes. */
export const audioHTMLView = $view(htmlSchema.node, () => (node, view, getPos) => {
  const raw = String(node.attrs.value)
  const dom = document.createElement('span')
  dom.dataset.type = 'html'; dom.dataset.value = raw
  if (!isAudioHTML(raw)) { dom.textContent = raw; return { dom } }
  const parsed = new DOMParser().parseFromString(raw, 'text/html').querySelector('audio')
  if (!parsed) { dom.textContent = raw; return { dom } }
  dom.className = 'editor-audio'; dom.contentEditable = 'false'
  dom.setAttribute('role', 'group'); dom.setAttribute('aria-label', t('音频附件'))
  const audio = document.createElement('audio')
  audio.preload = 'metadata'
  const title = document.createElement('span'); title.className = 'editor-audio-title'; title.textContent = t('音频附件')
  const status = document.createElement('span'); status.className = 'editor-audio-status'; status.setAttribute('role', 'status')
  const player = mountAudioPlayer(audio, message => { status.textContent = message })
  const actions = document.createElement('span'); actions.className = 'editor-audio-actions'
  let alive = true
  let reader: FileReader | undefined
  const currentPosition = () => {
    const position = getPos()
    if (position === undefined || view.state.doc.nodeAt(position)?.attrs.value !== raw) throw new Error(t('音频内容已更新，请重新选择'))
    return position
  }
  const button = (label: string, action: () => void) => {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = t(label)
    element.onclick = event => { event.preventDefault(); event.stopPropagation(); try { action() } catch (error) { status.textContent = String(error) } }
    actions.append(element)
  }
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'; input.hidden = true
  button('替换音频', () => input.click())
  button('删除附件', () => { const position = currentPosition(); view.dispatch(closeHistory(view.state.tr.delete(position, position + node.nodeSize))); view.focus() })
  button('查看原始标签', () => dom.dispatchEvent(new CustomEvent('editor-audio-source', { bubbles: true })))
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return
    reader?.abort()
    const nextReader = new FileReader()
    reader = nextReader
    nextReader.onload = () => {
      if (!alive) return
      try {
        const position = currentPosition()
        parsed.setAttribute('src', String(nextReader.result)); parsed.querySelectorAll('source').forEach(source => source.remove())
        view.dispatch(closeHistory(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, value: parsed.outerHTML })))
      } catch (error) { status.textContent = String(error) }
    }
    nextReader.onerror = () => { if (alive) status.textContent = t('音频文件无法读取') }
    nextReader.readAsDataURL(file)
    input.value = ''
  }
  const sources = [parsed, ...Array.from(parsed.querySelectorAll('source'))]
  void (async () => {
    for (const source of sources) {
      const src = source.getAttribute('src') ?? ''
      if (!src) continue
      if (!/^(?:data:audio\/|blob:|https?:\/\/|vibe-media:)/i.test(src)) continue
      const url = src.startsWith('vibe-media:') ? await loadMedia(src.slice(11)) : src
      if (!alive) return
      const target = source === parsed ? audio : document.createElement('source')
      target.setAttribute('src', url)
      if (source.getAttribute('type')) target.setAttribute('type', source.getAttribute('type')!)
      if (target !== audio) audio.append(target)
    }
    if (!alive) return
    if (!audio.src && !audio.querySelector('source')) status.textContent = t('音频来源无效或附件不可用')
    else audio.load()
  })().catch(() => { if (alive) status.textContent = t('附件未下载或已丢失，请完成同步后重试') })
  dom.append(title, audio, player.element, actions, input, status)
  return {
    dom,
    stopEvent: () => true,
    ignoreMutation: () => true,
    update: updated => updated.type === node.type && updated.attrs.value === raw,
    destroy: () => { alive = false; reader?.abort(); player.dispose(); audio.removeAttribute('src'); audio.replaceChildren(); audio.load() },
  }
})
