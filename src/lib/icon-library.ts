import { CORE_ICON_IDS } from '../config/icons'

declare global {
  interface Window {
    __lommeIconLibrary?: Promise<Response>
  }
}

const core = new Set<string>(CORE_ICON_IDS)
let pending: Promise<void> | null = null
let ready = false

/** True when the icon is already in the document and needs no fetch. */
export const isCoreIcon = (icon: string) => core.has(icon)
export const isIconLibraryReady = () => ready

/**
 * Pulls in the rest of the icon sprite. The document ships only the icons a wallet
 * shows at rest; everything else arrives the first time it is actually needed -
 * opening the picker, or rendering a category whose icon is outside that set.
 *
 * Resolves immediately on every later call, and never rejects: a missing library
 * degrades to the fallback glyph rather than breaking the screen.
 */
export function ensureIconLibrary(): Promise<void> {
  if (pending) return pending
  pending = (async () => {
    try {
      const response = await (window.__lommeIconLibrary
        ?? fetch(`${import.meta.env.BASE_URL}icons-library.svg`, { credentials: 'omit' }))
      if (!response.ok) return
      const markup = await response.text()
      const host = document.createElement('div')
      host.innerHTML = markup
      const sprite = host.firstElementChild
      if (sprite) {
        document.body.append(sprite)
        ready = true
      }
    } catch {
      // Offline or blocked: the fallback glyph is already in the core sprite.
    }
  })()
  return pending
}
