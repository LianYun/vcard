import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react'
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { useRef } from 'react'

interface Props {
  value: string
  onChange: (md: string) => void
}

function MilkdownInner({ value, onChange }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, value)
        ctx.get(listenerCtx).markdownUpdated((_ctx, md, prevMd) => {
          if (md !== prevMd) {
            onChangeRef.current(md)
          }
        })
      })
      .use(commonmark)
      .use(history)
      .use(listener)
      .use(clipboard)
  }, [])

  return <Milkdown />
}

export function MarkdownEditor({ value, onChange }: Props) {
  return (
    <div className="milkdown-wrap prose prose-sm prose-slate max-w-none min-h-[8rem] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-800 outline-none focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 [&_.editor]:outline-none [&_.editor]:min-h-[6rem]">
      <MilkdownProvider>
        <MilkdownInner value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  )
}
