import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { mountAudioPlayer } from '../lib/audioPlayer'
import { loadMedia } from '../lib/storage'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { createLogger } from '../lib/log'

const log = createLogger('markdown')

marked.setOptions({
  breaks: true,
  gfm: true,
})

interface Props {
  content: string
  className?: string
  stage?: string
}

export function Markdown({ content, className = '', stage }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [mediaError, setMediaError] = useState('')
  const [mediaRevision, setMediaRevision] = useState(0)
  useEffect(() => { const refresh = () => setMediaRevision(v => v + 1); window.addEventListener('vibe-library-changed', refresh); return () => window.removeEventListener('vibe-library-changed', refresh) }, [])
  const [zoom, setZoom] = useState<string | null>(null)
  const html = useMemo(() => {
    if (typeof content !== 'string') {
      log.warn('non-string content', { type: typeof content, content })
      return ''
    }
    try {
      return DOMPurify.sanitize(marked.parse(content, { async: false }) as string, { ADD_URI_SAFE_ATTR: ['data-media-id'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|data|blob|vibe-media):|[^a-z]|[a-z+.-]+(?:[^a-z+.:.-]|$))/i })
    } catch (err) {
      log.error('parse failed', err, { content: content.slice(0, 100) })
      return DOMPurify.sanitize(content)
    }
  }, [content])

  useEffect(() => {
    const element = root.current
    if (!element) return
    let live = true
    setMediaError('')
    const cleanupPlayers: (() => void)[] = []
    const media = Array.from(element.querySelectorAll<HTMLImageElement | HTMLAudioElement>('img, audio'))
    for (const item of media) {
      const source = item.dataset.mediaSource ?? item.getAttribute('src') ?? ''
      if (source.startsWith('vibe-media:')) {
        item.dataset.mediaSource = source
        item.removeAttribute('src')
        void loadMedia(source.slice(11), stage).then(url => { if (live) item.src = url }).catch(() => { if(live) setMediaError(t('附件未下载或已丢失，请完成同步后重试')) })
      }
      if (item instanceof HTMLAudioElement) {
        const player = mountAudioPlayer(item, message => { if (live) setMediaError(message) })
        item.after(player.element)
        cleanupPlayers.push(player.dispose)
      }
    }
    const visibility = () => { if (document.hidden || element.closest('[hidden]')) media.forEach(m => { if(m instanceof HTMLAudioElement)m.pause() }) }
    const observer = new MutationObserver(visibility); observer.observe(document.body, {subtree:true,attributes:true,attributeFilter:['hidden']})
    document.addEventListener('visibilitychange', visibility)
    return () => { live = false; media.forEach(m => { if(m instanceof HTMLAudioElement)m.pause() }); cleanupPlayers.forEach(cleanup => cleanup()); observer.disconnect();document.removeEventListener('visibilitychange',visibility) }
  }, [html, stage, mediaRevision])
  return <>
    <div ref={root} onClick={event => { const target = event.target; if(target instanceof HTMLImageElement && target.src) { event.stopPropagation();setZoom(target.src) } }}
      className={`prose prose-sm prose-slate max-w-none [&_img]:max-h-48 [&_img]:w-auto [&_img]:rounded-lg [&_img]:mx-auto [&_audio]:max-w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: html }} />
    {mediaError && <p role="status">{mediaError}</p>}
    {zoom && <div role="dialog" aria-modal="true" aria-label="图片" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={e=>{e.stopPropagation();setZoom(null)}}><button autoFocus className="absolute right-5 top-5 text-white" onKeyDown={e=>{if(e.key==='Escape')setZoom(null)}} onClick={()=>setZoom(null)}>关闭 ×</button><img src={zoom} alt="" className="max-h-full max-w-full"/></div>}
  </>
}
