/**
 * Telegram Mini App bootstrap shared by the real app and the design preview.
 *
 * Everything here is optional-chained: the same build has to run in a plain browser
 * (design review, local dev) where `window.Telegram` simply does not exist.
 */

type BackButton = { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void }

type Haptic = {
  impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
  notificationOccurred?(type: 'error' | 'success' | 'warning'): void
  selectionChanged?(): void
}

export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed'

type WebAppEventHandler = (payload?: unknown) => void

type WebApp = {
  initData: string
  initDataUnsafe?: { start_param?: string }
  platform?: string
  colorScheme: 'light' | 'dark'
  viewportStableHeight?: number
  viewportHeight?: number
  isExpanded?: boolean
  BackButton?: BackButton
  HapticFeedback?: Haptic
  isFullscreen?: boolean
  requestFullscreen?(): void
  exitFullscreen?(): void
  safeAreaInset?: { top: number; bottom: number; left: number; right: number }
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number }
  ready(): void
  expand(): void
  close(): void
  isVersionAtLeast?(version: string): boolean
  addToHomeScreen?(): void
  checkHomeScreenStatus?(callback?: (status: HomeScreenStatus) => void): void
  disableVerticalSwipes?(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  openLink?(url: string, options?: { tryInstantView?: boolean }): void
  openTelegramLink?(url: string): void
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void
  writeTextToClipboard?(text: string, callback?: (success: boolean) => void): void
  onEvent?(event: string, handler: WebAppEventHandler): void
  offEvent?(event: string, handler: WebAppEventHandler): void
}

export const webApp = (): WebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp

/**
 * telegram-web-app.js defines window.Telegram even in a plain browser, where both
 * initData is empty and platform is "unknown". A real launch may provide either
 * signal first, so accept signed initData without waiting for platform.
 */
export const isTelegram = () => {
  const app = webApp()
  const platform = app?.platform
  // A signed launch payload is authoritative. Some iOS clients expose it before
  // `platform`, so gating only on platform skipped viewport/safe-area setup and
  // left the editor Back control underneath Telegram's native chrome.
  return Boolean(app && (app.initData || (platform && platform !== 'unknown')))
}

/** Lomme deliberately keeps one light appearance even when Telegram is dark. */
export function syncTelegramTheme() {
  const app = webApp()
  if (!app || !isTelegram()) return
  app.setHeaderColor?.('#ffffff')
  app.setBackgroundColor?.('#ffffff')
}

/** Prefer Telegram's native clipboard bridge on iPhone. Safari's clipboard API
 * can lose its user-gesture permission while a key-creation request is running. */
export async function copyText(text: string): Promise<boolean> {
  const app = webApp()
  if (app?.writeTextToClipboard) {
    return new Promise((resolve) => app.writeTextToClipboard!(text, resolve))
  }
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch { return false }
}

/** Open an HTTPS link from the click handler that called this function.
 * Telegram intentionally blocks openLink when it is delayed until after a
 * network request, so this helper must stay synchronous. */
export function openExternalLink(url: string): boolean {
  const app = webApp()
  // Keep this as the first native bridge call made by the click handler. The
  // iOS client accepts web_app_open_link only in its user-interaction window.
  if (app?.openLink) {
    try {
      app.openLink(url)
      return true
    } catch {
      // Fall through to ordinary navigation on incomplete client bridges.
    }
  }
  try {
    window.location.assign(url)
    return true
  } catch { return false }
}

function startParamFromLocation() {
  for (const raw of [window.location.search, window.location.hash]) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ''))
    const direct = params.get('tgWebAppStartParam') || params.get('startapp')
    if (direct) return direct
    // Some clients keep the signed launch payload inside tgWebAppData in the
    // webview URL rather than exposing tgWebAppStartParam as a top-level field.
    const initData = params.get('tgWebAppData')
    const nested = initData ? new URLSearchParams(initData).get('start_param') : null
    if (nested) return nested
  }
  return null
}

/** Whatever `startapp=` carried, from whichever source published it first. */
function launchParam(serverStartParam?: string | null) {
  const app = webApp()
  const fromSignedInitData = app?.initData ? new URLSearchParams(app.initData).get('start_param') : null
  return serverStartParam || app?.initDataUnsafe?.start_param || fromSignedInitData || startParamFromLocation() || ''
}

/** The Bot API encodes wallet invites as `invite_<opaque token>` in startapp.
 * The serverStartParam argument comes from signature-verified initData. */
export function telegramInviteToken(serverStartParam?: string | null): string | null {
  const value = launchParam(serverStartParam)
  if (!value.startsWith('invite_')) return null
  const token = value.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{20,120}$/.test(token) ? token : null
}

/**
 * Screens the bot is allowed to open directly. Keeping this an explicit list
 * means a stale or mistyped link lands on the home screen rather than
 * somewhere unexpected, and a button in the chat can promise a real
 * destination instead of "the app".
 */
const LAUNCH_TARGETS = ['shortcut', 'notifications', 'family', 'analytics'] as const
export type LaunchTarget = typeof LAUNCH_TARGETS[number]

export function telegramLaunchTarget(serverStartParam?: string | null): LaunchTarget | null {
  const value = launchParam(serverStartParam)
  return (LAUNCH_TARGETS as readonly string[]).includes(value) ? value as LaunchTarget : null
}

/** Keep a launch token captured before async Telegram authentication. iOS may
 * reuse a WebView and replace its visible URL while auth is in flight. */
export function resolveTelegramInviteToken(remembered: string | null, serverStartParam?: string | null) {
  return remembered || telegramInviteToken(serverStartParam)
}

export function shareTelegramLink(url: string, text: string): boolean {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const app = webApp()
  if (app?.openTelegramLink) {
    try { app.openTelegramLink(shareUrl); return true } catch { /* use navigation fallback */ }
  }
  return openExternalLink(shareUrl)
}

/**
 * Menu-button launches do not inherit the Main Mini App launch mode. Promote a
 * successfully authenticated launch once, after React has mounted. The attempt
 * marker is written before the native bridge call because Telegram iOS may
 * recreate the WebView while entering fullscreen; the recreated page must not
 * request the same transition again.
 */
export function ensureTelegramFullscreen(): boolean {
  const app = webApp()
  if (!app || !isTelegram() || app.isFullscreen) return false

  const initData = new URLSearchParams(app.initData || '')
  const launchId = initData.get('query_id') || initData.get('auth_date') || 'current'
  const attemptKey = `lomme:fullscreen-attempt:${launchId}`
  try {
    if (window.sessionStorage?.getItem(attemptKey)) return false
    window.sessionStorage?.setItem(attemptKey, '1')
  } catch {
    // Private-mode storage can be unavailable. A module-level guard still keeps
    // the current document from issuing duplicate bridge calls.
    if (fullscreenAttemptedInDocument) return false
  }
  fullscreenAttemptedInDocument = true

  if (app.requestFullscreen && app.isVersionAtLeast?.('8.0') !== false) {
    app.requestFullscreen()
    return true
  }
  app.expand()
  return true
}

let fullscreenAttemptedInDocument = false

/** Some iOS Telegram builds report `platform` late, but the WebView user agent
 * is already available while the initial viewport is being calculated. */
const isIOSClient = (app: WebApp) =>
  app.platform === 'ios' || /iPad|iPhone|iPod/.test(window.navigator?.userAgent || '')

/**
 * Telegram's webview reports a viewport that `100svh` does not match — the keyboard,
 * the drag-to-close header and the bottom bar all move it. Mirror the real numbers
 * into CSS variables and keep them in sync.
 */
function syncViewport(app: WebApp) {
  const iOS = isIOSClient(app)
  const apply = () => {
    const height = app.viewportStableHeight || app.viewportHeight
    if (height) document.documentElement.style.setProperty('--app-vh', `${height}px`)
    // Bot API 8.0+; older clients keep the env() fallbacks already in the CSS.
    const device = app.safeAreaInset
    const chrome = app.contentSafeAreaInset
    if (device || chrome || iOS) {
      // Telegram reports the device cutout and its transparent control row as
      // separate bands. They are additive: choosing only the larger one lets
      // Lomme's account pill slide under Close / collapse / menu.
      const reportedTop = (device?.top ?? 0) + (chrome?.top ?? 0)
      // Some iOS builds initially publish only the device inset. In fullscreen
      // the native control row is still present, so retain a conservative floor
      // until contentSafeAreaInset arrives. Do not apply it to an ordinary sheet,
      // where Telegram may position the WebView below its header already.
      const expandedOverlayFallback = iOS && app.isFullscreen ? 88 : 0
      const top = Math.max(reportedTop, expandedOverlayFallback)
      const bottom = Math.max(device?.bottom ?? 0, chrome?.bottom ?? 0)
      document.documentElement.style.setProperty('--tg-js-safe-top', `${top}px`)
      document.documentElement.style.setProperty('--tg-js-safe-bottom', `${bottom}px`)
      // The device notch alone: the top bar sits in the band Telegram's controls
      // occupy so it lines up beside them rather than starting below them.
      document.documentElement.style.setProperty('--tg-device-top', `${device?.top ?? 0}px`)
    }
  }
  apply()
  app.onEvent?.('viewportChanged', apply)
  app.onEvent?.('safeAreaChanged', apply)
  app.onEvent?.('contentSafeAreaChanged', apply)
  app.onEvent?.('fullscreenChanged', apply)
}

export function initTelegram() {
  const app = webApp()
  if (!app || !isTelegram()) return
  app.ready()
  // Fullscreen is selected by BotFather for Main App launches and by
  // `mode=fullscreen` on invitation links. Calling expand() from every bootstrap
  // makes Telegram iOS rebuild the cached WebView; the rebuilt page calls it
  // again and gets trapped on Lomme's initial loader.
  // Keep bootstrap passive apart from ready(). Telegram's own SDK already asks
  // the client for viewport and safe-area values. Re-sending those bridge events
  // and changing swipe behavior while iOS is mounting a fullscreen Main App can
  // recreate the WebView after the first successful snapshot.
  syncTelegramTheme()
  document.documentElement.classList.add('in-telegram')
  syncViewport(app)
}

/**
 * Drives Telegram's native back button. Returns a cleanup so React effects can
 * hand control back when the screen closes.
 */
export function setBackButton(visible: boolean, onBack: () => void) {
  const button = webApp()?.BackButton
  if (!button) return () => {}
  if (!visible) { button.hide(); return () => {} }
  button.onClick(onBack)
  button.show()
  return () => { button.offClick(onBack); button.hide() }
}

export function checkHomeScreenShortcut(): Promise<HomeScreenStatus> {
  const app = webApp()
  if (!app || !isTelegram() || !app.addToHomeScreen || !app.checkHomeScreenStatus) return Promise.resolve('unsupported')
  return new Promise((resolve) => app.checkHomeScreenStatus?.((status) => resolve(status)))
}

export function addHomeScreenShortcut() {
  const app = webApp()
  if (!app || !isTelegram() || !app.addToHomeScreen) return false
  app.addToHomeScreen()
  return true
}

export function onHomeScreenAdded(handler: () => void) {
  const app = webApp()
  if (!app?.onEvent) return () => {}
  const telegramHandler = () => handler()
  app.onEvent('homeScreenAdded', telegramHandler)
  return () => app.offEvent?.('homeScreenAdded', telegramHandler)
}


/**
 * Telegram's haptics. `selection` is the light tick the iOS pickers use - the one
 * that makes dragging feel physical rather than visual.
 */
export const haptics = {
  selection() {
    const feedback = webApp()?.HapticFeedback
    if (feedback?.selectionChanged) feedback.selectionChanged()
    else feedback?.impactOccurred?.('light')
  },
  impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') {
    webApp()?.HapticFeedback?.impactOccurred?.(style)
  },
  notify(type: 'error' | 'success' | 'warning') { webApp()?.HapticFeedback?.notificationOccurred?.(type) },
}
