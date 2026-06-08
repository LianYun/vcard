import { useMemo } from 'react'
import { marked } from 'marked'

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
    return marked.parse(content, { async: false }) as string
  }, [content])

  return (
    <div
      className={`prose prose-sm prose-slate max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
