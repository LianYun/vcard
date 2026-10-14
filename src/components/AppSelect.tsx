import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './AppSelect.css'

interface Props<T extends string> {
  id?: string
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}

/** Shared select: themed popup, bounded positioning, and keyboard navigation. */
export function AppSelect<T extends string>({ id: suppliedId, label, value, options, onChange, disabled = false, className = '', placeholder = '—' }: Props<T>) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', time: 0 })
  const selected = options.findIndex(option => option.value === value)
  const expanded = open && !disabled && options.length > 0
  const activeIndex = Math.min(active, options.length - 1)

  function show() {
    if (trigger.current?.matches(':disabled') || !options.length) return
    setActive(Math.max(0, selected)); setOpen(true)
  }
  function choose(index: number) {
    if (!trigger.current?.matches(':disabled') && options[index]) onChange(options[index].value)
    setOpen(false); trigger.current?.focus()
  }

  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds) return
      const viewport = window.visualViewport
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0
      const height = viewport?.height ?? window.innerHeight, width = viewport?.width ?? window.innerWidth
      const below = top + height - bounds.bottom - 14, above = bounds.top - top - 14
      const upwards = below < Math.min(260, options.length * 44 + 12) && above > below
      const maxHeight = Math.max(44, Math.min(300, upwards ? above : below))
      const menuWidth = Math.min(Math.max(bounds.width, 220), width - 16)
      // Measure wrapping at the final width before positioning an upward popup.
      if (menu.current) menu.current.style.width = `${menuWidth}px`
      const menuHeight = Math.min((menu.current?.scrollHeight ?? maxHeight) + 2, maxHeight)
      setPosition({ position: 'fixed', width: menuWidth, maxHeight,
        left: Math.max(left + 8, Math.min(bounds.left, left + width - menuWidth - 8)),
        top: upwards ? Math.max(top + 8, bounds.top - menuHeight - 6) : bounds.bottom + 6 })
    }
    place()
    const onScroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place() }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [expanded, options])

  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])

  useLayoutEffect(() => {
    if (!expanded) return
    const option = menu.current?.children[activeIndex] as HTMLElement | undefined
    const list = menu.current
    if (option && list) {
      if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
      else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
    }
  }, [activeIndex, expanded, position])

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (event.key === 'Tab') { setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!expanded) show()
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : !expanded ? Math.max(0, selected) : Math.max(0, Math.min(options.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (expanded) choose(activeIndex); else show()
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now(), key = event.key.toLocaleLowerCase()
      const prefix = now - search.current.time < 700 ? search.current.text + key : key
      search.current = { text: prefix, time: now }
      const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(prefix))
      if (index >= 0) { event.preventDefault(); setActive(index); setOpen(true) }
    }
  }

  return <span ref={root} className={`app-select ${className}`} onBlur={event => {
    if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} id={id} type="button" className="app-field app-select-trigger"
      role="combobox" aria-label={label} aria-haspopup="listbox" disabled={disabled || !options.length}
      aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined}
      aria-activedescendant={expanded && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      onKeyDown={onKeyDown} onClick={() => expanded ? setOpen(false) : show()}>
      <span>{options[selected]?.label ?? placeholder}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {expanded && createPortal(<div ref={menu} id={`${id}-options`} role="listbox" aria-label={label}
      className="app-select-menu" style={position} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`}
        role="option" aria-selected={option.value === value} className="app-select-option" data-active={index === activeIndex}
        onPointerMove={() => setActive(index)} onClick={event => { event.stopPropagation(); choose(index) }}>
        <span>{option.label}</span><span aria-hidden="true" className="app-select-check">{option.value === value ? '✓' : ''}</span>
      </div>)}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </span>
}
