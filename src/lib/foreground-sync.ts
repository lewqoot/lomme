import { webApp } from './telegram.js'

type Cleanup = () => void

/**
 * Telegram hands control to native apps (Shortcuts, the camera, Safari) without
 * always producing the same browser event on every iOS version. Listen to all
 * supported foreground signals and collapse the duplicate events into one
 * refresh. This keeps the current screen mounted while React Query replaces the
 * snapshot in place.
 */
export function subscribeToForeground(refresh: () => void, minIntervalMs = 750): Cleanup {
  let lastRefreshAt = 0
  const onForeground = () => {
    if (document.visibilityState === 'hidden') return
    const now = Date.now()
    if (now - lastRefreshAt < minIntervalMs) return
    lastRefreshAt = now
    refresh()
  }

  window.addEventListener('focus', onForeground)
  document.addEventListener('visibilitychange', onForeground)
  const telegram = webApp()
  telegram?.onEvent?.('activated', onForeground)

  return () => {
    window.removeEventListener('focus', onForeground)
    document.removeEventListener('visibilitychange', onForeground)
    telegram?.offEvent?.('activated', onForeground)
  }
}
