import { useMemo } from 'react'
import { marked } from 'marked'
import { createLogger } from '../lib/log'

const log = createLogger('markdown')

marked.setOptions({
  breaks: true,
  gfm: true,
})

interface Props {
  content: string
  className?: string
}

export function Markdown({ content, className = '' }: Props) {
  const html = useMemo(() => {
    if (typeof content !== 'string') {
      log.warn('non-string content', { type: typeof content, content })
      return ''
    }
    try {
      return marked.parse(content, { async: false }) as string
    } catch (err) {
      log.error('parse failed', err, { content: content.slice(0, 100) })
      return content
    }
  }, [content])

  return (
    <div
      className={`prose prose-sm prose-slate max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
