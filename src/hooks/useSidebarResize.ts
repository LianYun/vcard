import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import { loadSidebarWidth, saveSidebarWidth } from '../lib/storage'

export function useSidebarResize(native: boolean) {
  const [preferredWidth, setPreferredWidth] = useState(loadSidebarWidth)
  const [viewport, setViewport] = useState(window.innerWidth)
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const maximum = Math.max(160, Math.min(360, viewport - 480))
  const defaultWidth = viewport <= 1100 ? (native ? 176 : 172) : (native ? 212 : 208)
  const width = Math.max(160, Math.min(maximum, preferredWidth ?? defaultWidth))
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const update = (next: number) => {
    const value = Math.round(Math.max(160, Math.min(maximum, next)))
    setPreferredWidth(value)
    saveSidebarWidth(value)
  }
  const handleProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator', tabIndex: 0,
    'aria-orientation': 'vertical', 'aria-valuemin': 160,
    'aria-valuemax': maximum, 'aria-valuenow': width,
    'data-dragging': dragging ? 'true' : undefined,
    onPointerDown: event => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { pointerId: event.pointerId, x: event.clientX, width }
      setDragging(true)
    },
    onPointerMove: event => {
      if (drag.current?.pointerId === event.pointerId) update(drag.current.width + event.clientX - drag.current.x)
    },
    onPointerUp: event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      drag.current = null
      setDragging(false)
    },
    onPointerCancel: () => { drag.current = null; setDragging(false) },
    onLostPointerCapture: () => { drag.current = null; setDragging(false) },
    onKeyDown: event => {
      const next = { ArrowLeft: width - 10, ArrowRight: width + 10, Home: 160, End: maximum }[event.key]
      if (next === undefined) return
      event.preventDefault()
      event.stopPropagation()
      update(next)
    },
  } as HTMLAttributes<HTMLDivElement>
  return { style: { '--sidebar-width': `${width}px` } as CSSProperties, handleProps }
}
