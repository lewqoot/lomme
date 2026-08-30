import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Fixed in CSS; kept here so the anchor maths does not need to measure the menu. */
const MENU_WIDTH = 232

/**
 * The iOS-style popover the reference uses for the period presets and the chart
 * type. Portalled to <body>: inside the shell it would be trapped under the
 * stacking contexts the blurred header and the journal create, and clipped by the
 * shell's `overflow: clip`.
 */
export function useAnchoredMenu(anchor: { current: HTMLElement | null }) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const [closing, setClosing] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const open = box !== null

  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) return null
    const margin = 10
    const half = MENU_WIDTH / 2
    return {
      top: rect.bottom + 7,
      left: Math.min(Math.max(margin + half, rect.left + rect.width / 2), window.innerWidth - margin - half),
    }
  }, [anchor])
  const close = useCallback(() => {
    if (!box || closing) return
    setClosing(true)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(() => {
      setBox(null)
      setClosing(false)
      closeTimer.current = null
    }, reduced ? 120 : 160)
  }, [box, closing])
  const toggle = () => {
    if (open) close()
    else {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      setClosing(false)
      setBox(place())
    }
  }

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (!open) return
    const reposition = () => setBox(place())
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (anchor.current?.contains(event.target as Node) || menu.current?.contains(event.target as Node)) return
      close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    // Deferred so the click that opened the menu does not immediately close it.
    const id = window.setTimeout(() => document.addEventListener('pointerdown', outside), 0)
    document.addEventListener('keydown', escape)
    return () => { window.clearTimeout(id); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open, anchor, close])

  const render = (children: ReactNode) => open && createPortal(<>
    <div className={`period-scrim${closing ? ' closing' : ''}`} onClick={close} />
    <div className={`period-menu${closing ? ' closing' : ''}`} role="menu" ref={menu} style={{ top: box.top, left: box.left }}>{children}</div>
  </>, document.body)

  return { open, toggle, close, render }
}
