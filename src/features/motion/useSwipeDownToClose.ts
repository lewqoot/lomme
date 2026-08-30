import { useEffect, useRef, useState } from 'react'
import { haptics } from '../../lib/telegram'

const THRESHOLD = 108

/**
 * Lets a sheet be pushed back down. The card follows the finger one-to-one while
 * the page is at the top; past the threshold it closes, otherwise it springs back.
 *
 * The gesture only claims a drag that starts at scrollTop 0 and moves downward, so
 * ordinary scrolling inside the sheet is untouched.
 */
export function useSwipeDownToClose(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'dragging' | 'settling'>('idle')
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    let startY: number | null = null
    let engaged = false
    let offset = 0
    let ticked = false

    const atTop = () => (window.scrollY || document.documentElement.scrollTop) <= 1
    const setOffset = (value: number) => {
      offset = value
      node.style.setProperty('--drag', `${value}px`)
      if (!ticked && value > THRESHOLD) { ticked = true; haptics.selection() }
      if (ticked && value <= THRESHOLD) ticked = false
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !atTop()) return
      startY = event.touches[0].clientY
      engaged = false
      offset = 0
    }
    const onMove = (event: TouchEvent) => {
      if (startY === null) return
      const delta = event.touches[0].clientY - startY
      if (!engaged) {
        if (delta < 8) return
        if (!atTop()) { startY = null; return }
        engaged = true
        setState('dragging')
      }
      // Non-passive: this is what stops the browser from taking the drag halfway.
      event.preventDefault()
      // Resistance past the threshold so the card never feels detached.
      setOffset(delta > THRESHOLD ? THRESHOLD + (delta - THRESHOLD) * 0.4 : Math.max(0, delta))
    }
    const onEnd = () => {
      if (startY === null) return
      const reached = engaged && offset > THRESHOLD
      startY = null
      engaged = false
      ticked = false
      if (reached) { haptics.impact('medium'); setState('idle'); node.style.removeProperty('--drag'); close.current(); return }
      setState('settling')
      window.setTimeout(() => { setState('idle'); node.style.removeProperty('--drag') }, 300)
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

  return [ref, state] as const
}
