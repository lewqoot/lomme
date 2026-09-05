import { useEffect, useRef, useState } from 'react'
import { haptics } from '../../lib/telegram'

/** Where the button rests when uncovered, and how far the row will travel at all. */
const REVEAL = 92
const MAX = 116

/**
 * Swipe a row left to uncover a delete button. The swipe only ever uncovers it -
 * removing the row is a deliberate tap on the button, so a long drag can never
 * delete something by accident. Dragging back to the right closes it again.
 *
 * The drag continues from wherever the row already sits, so an open row does not
 * jump back to zero the moment a second gesture starts. Only clearly horizontal
 * movement is claimed - anything else belongs to the list.
 */
export function useSwipeToDelete(onDelete: () => void, enabled = true) {
  const row = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [settling, setSettling] = useState(false)
  const held = useRef(0)
  const remove = useRef(onDelete)
  useEffect(() => { remove.current = onDelete })

  useEffect(() => {
    const node = row.current
    if (!node || !enabled) return
    let start: { x: number; y: number } | null = null
    let base = 0
    let axis: 'none' | 'x' | 'y' = 'none'
    let armed = false

    const apply = (value: number) => {
      held.current = value
      setOffset(value)
      // One tick as the button reaches its resting width.
      if (!armed && value >= REVEAL) { armed = true; haptics.selection() }
      if (armed && value < REVEAL) armed = false
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      base = held.current
      axis = 'none'
      setSettling(false)
    }
    const onMove = (event: TouchEvent) => {
      if (!start) return
      const dx = event.touches[0].clientX - start.x
      const dy = event.touches[0].clientY - start.y
      if (axis === 'none') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        // Horizontal in either direction once the row is open; only leftward while
        // it is closed, so a closed list still scrolls under the same finger.
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.3
        axis = horizontal && (base > 0 || dx < 0) ? 'x' : 'y'
        if (axis === 'y') { start = null; return }
      }
      event.preventDefault()
      const raw = base - dx
      // Resistance past the widest the button ever gets.
      apply(raw <= 0 ? 0 : raw > MAX ? MAX + (raw - MAX) * 0.2 : raw)
    }
    const onEnd = () => {
      const wasDragging = axis === 'x'
      start = null
      axis = 'none'
      armed = false
      if (!wasDragging) return
      setSettling(true)
      apply(held.current > REVEAL / 2 ? REVEAL : 0)
    }

    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove', onMove, { passive: false })
    node.addEventListener('touchend', onEnd)
    node.addEventListener('touchcancel', onEnd)
    return () => {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])

  const close = () => { setSettling(true); held.current = 0; setOffset(0) }
  return { row, offset, settling, close, revealed: offset >= REVEAL / 2 }
}
