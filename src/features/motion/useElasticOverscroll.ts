import { useEffect } from 'react'
import { isTelegram } from '../../lib/telegram.js'

const MAX_OFFSET = 52
const RESISTANCE = 82
const MAX_STRETCH = 0.022
const RELEASE_MS = 520

/** Diminishing resistance: a long pull never drags the whole app off-screen. */
export function elasticOffset(distance: number) {
  const safeDistance = Math.max(0, distance)
  return MAX_OFFSET * (1 - Math.exp(-safeDistance / RESISTANCE))
}

export function elasticScale(offset: number, extent = 874) {
  const safeExtent = Math.max(1, extent)
  return 1 + Math.min(Math.abs(offset) * 0.38 / safeExtent, MAX_STRETCH)
}

/**
 * Adds an iOS-like rubber band at the document boundaries while leaving normal
 * scrolling to the browser. The home pull-to-open gesture gets first refusal:
 * when it prevents the touch event, this hook stays out of its way.
 */
export function useElasticOverscroll() {
  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    // Telegram owns the native pull/close gesture. Transforming the entire
    // shell at the same time is fragile in its iOS WebView: a system cancel can
    // leave the header offset and temporarily untappable. Keep the elastic
    // feedback for the browser preview only; the Mini App uses Telegram's
    // native overscroll instead.
    if (reducedMotion?.matches || isTelegram()) return

    let lastY: number | null = null
    let startX = 0
    let startY = 0
    let pull = 0
    let direction: -1 | 0 | 1 = 0
    let shell: HTMLElement | null = null
    let cleanupTimer: number | undefined

    const clearVisual = () => {
      if (cleanupTimer) window.clearTimeout(cleanupTimer)
      cleanupTimer = undefined
      shell?.classList.remove('elastic-overscroll', 'elastic-releasing')
      shell?.style.removeProperty('--elastic-y')
      shell?.style.removeProperty('--elastic-scale-y')
      shell?.style.removeProperty('--elastic-origin')
      shell = null
    }

    const scrollTop = () => window.scrollY || document.documentElement.scrollTop || 0
    const maxScroll = () => Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight)
    const atTop = () => scrollTop() <= 1
    const atBottom = () => scrollTop() >= maxScroll() - 1

    const release = () => {
      lastY = null
      pull = 0
      direction = 0
      if (!shell) return
      shell.classList.add('elastic-releasing')
      cleanupTimer = window.setTimeout(clearVisual, RELEASE_MS + 80)
    }

    const begin = (clientX: number, clientY: number) => {
      clearVisual()
      startX = clientX
      startY = clientY
      lastY = clientY
      pull = 0
      direction = 0
    }

    const move = (clientX: number, clientY: number, target: EventTarget | null, blocked: boolean, prevent: () => void) => {
      if (lastY === null || blocked) return
      if (target instanceof Element && target.closest('input, textarea, select, [data-elastic-scroll-ignore]')) return

      const deltaY = clientY - lastY
      const totalX = clientX - startX
      const totalY = clientY - startY
      lastY = clientY

      if (direction === 0) {
        if (Math.abs(totalY) < 5 || Math.abs(totalX) > Math.abs(totalY)) return
        if (deltaY > 0 && atTop()) direction = 1
        else if (deltaY < 0 && atBottom()) direction = -1
        else return
      }

      pull = Math.max(0, pull + direction * deltaY)
      if (pull === 0) { release(); return }

      const offset = direction * elasticOffset(pull)
      shell ||= document.querySelector<HTMLElement>('.app-shell')
      if (!shell) return
      shell.classList.add('elastic-overscroll')
      shell.classList.remove('elastic-releasing')
      shell.style.setProperty('--elastic-y', `${offset.toFixed(2)}px`)
      shell.style.setProperty('--elastic-scale-y', elasticScale(offset, shell.scrollHeight).toFixed(4))
      shell.style.setProperty('--elastic-origin', direction > 0 ? '50% 0%' : '50% 100%')
      prevent()
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches.item(0)
      if (touch) begin(touch.clientX, touch.clientY)
    }

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches.item(0)
      if (touch) move(touch.clientX, touch.clientY, event.target, event.defaultPrevented, () => { if (event.cancelable) event.preventDefault() })
    }

    // Desktop preview uses a mouse, so mirror the same physical drag there. Touch
    // pointers stay on the native touch path above to avoid handling them twice.
    const onPointerStart = (event: PointerEvent) => { if (event.pointerType === 'mouse' && event.button === 0) begin(event.clientX, event.clientY) }
    const onPointerMove = (event: PointerEvent) => { if (event.pointerType === 'mouse' && event.buttons === 1) move(event.clientX, event.clientY, event.target, event.defaultPrevented, () => { if (event.cancelable) event.preventDefault() }) }
    const onPointerEnd = (event: PointerEvent) => { if (event.pointerType === 'mouse') release() }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', release)
    document.addEventListener('touchcancel', release)
    document.addEventListener('pointerdown', onPointerStart)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', release)
      document.removeEventListener('touchcancel', release)
      document.removeEventListener('pointerdown', onPointerStart)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      clearVisual()
    }
  }, [])
}
