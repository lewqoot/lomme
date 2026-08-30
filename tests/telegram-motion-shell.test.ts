/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureTelegramFullscreen, haptics, initTelegram, isTelegram, setBackButton, syncTelegramTheme } from '../src/lib/telegram.js'

describe('Telegram motion shell', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['ios', 'android'])('синхронизирует viewport, safe-area и клавиатуру на %s', (platform) => {
    const properties = new Map<string, string>()
    const events = new Map<string, () => void>()
    const postEvent = vi.fn()
    const app = {
      initData: 'signed', platform, colorScheme: 'light' as const,
      viewportStableHeight: 780,
      isFullscreen: true,
      safeAreaInset: { top: 12, bottom: 20, left: 0, right: 0 },
      contentSafeAreaInset: { top: 34, bottom: 6, left: 0, right: 0 },
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(),
      disableVerticalSwipes: vi.fn(), requestFullscreen: vi.fn(), exitFullscreen: vi.fn(),
      isVersionAtLeast: vi.fn(() => true),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
      onEvent: vi.fn((event: string, handler: () => void) => events.set(event, handler)),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app, WebView: { postEvent } } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: vi.fn() },
        style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      },
    })

    initTelegram()
    expect(properties.get('--app-vh')).toBe('780px')
    expect(properties.get('--tg-js-safe-top')).toBe(platform === 'ios' ? '88px' : '46px')
    expect(properties.get('--tg-js-safe-bottom')).toBe('20px')
    expect(postEvent).not.toHaveBeenCalled()

    expect(app.requestFullscreen).not.toHaveBeenCalled()
    expect(app.exitFullscreen).not.toHaveBeenCalled()
    expect(app.expand).not.toHaveBeenCalled()

    // Telegram emits viewportChanged when its keyboard changes the usable height.
    app.viewportStableHeight = 512
    events.get('viewportChanged')?.()
    expect(properties.get('--app-vh')).toBe('512px')
    expect(app.disableVerticalSwipes).not.toHaveBeenCalled()
  })

  it('не добавляет fullscreen inset в обычном iPhone sheet, если клиент его не отдал', () => {
    const properties = new Map<string, string>()
    const app = {
      initData: 'signed', platform: 'ios', colorScheme: 'light' as const,
      viewportStableHeight: 780,
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(),
      disableVerticalSwipes: vi.fn(), requestFullscreen: vi.fn(), exitFullscreen: vi.fn(),
      isVersionAtLeast: vi.fn(() => true),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), onEvent: vi.fn(),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: vi.fn() },
        style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      },
    })

    initTelegram()
    expect(properties.get('--tg-js-safe-top')).toBe('0px')
    expect(app.requestFullscreen).not.toHaveBeenCalled()
    expect(app.expand).not.toHaveBeenCalled()
  })

  it('распознаёт подписанный Telegram-запуск до появления platform', () => {
    const classAdd = vi.fn()
    const app = {
      initData: 'signed-launch', platform: 'unknown', colorScheme: 'light' as const,
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(), disableVerticalSwipes: vi.fn(),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), onEvent: vi.fn(),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app }, navigator: { userAgent: 'iPhone' } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: classAdd },
        style: { setProperty: vi.fn() },
      },
    })

    expect(isTelegram()).toBe(true)
    initTelegram()
    expect(app.ready).toHaveBeenCalledOnce()
    expect(classAdd).toHaveBeenCalledWith('in-telegram')
  })

  it('один раз переводит menu-button запуск в fullscreen и не зацикливается после reload', () => {
    const stored = new Map<string, string>()
    const requestFullscreen = vi.fn()
    const app = {
      initData: 'query_id=menu-launch-1&auth_date=1788100000',
      platform: 'ios', colorScheme: 'light' as const, isFullscreen: false,
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(), requestFullscreen,
      isVersionAtLeast: vi.fn(() => true),
    }
    vi.stubGlobal('window', {
      Telegram: { WebApp: app },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    })

    expect(ensureTelegramFullscreen()).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(app.expand).not.toHaveBeenCalled()

    expect(ensureTelegramFullscreen()).toBe(false)
    expect(requestFullscreen).toHaveBeenCalledOnce()
  })

  it('использует expand один раз на клиенте без fullscreen API', () => {
    const stored = new Map<string, string>()
    const app = {
      initData: 'query_id=legacy-launch', platform: 'ios', colorScheme: 'light' as const,
      isFullscreen: false, ready: vi.fn(), expand: vi.fn(), close: vi.fn(),
      isVersionAtLeast: vi.fn(() => false),
    }
    vi.stubGlobal('window', {
      Telegram: { WebApp: app },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    })

    expect(ensureTelegramFullscreen()).toBe(true)
    expect(app.expand).toHaveBeenCalledOnce()
    expect(ensureTelegramFullscreen()).toBe(false)
  })

  it('сохраняет fullscreen и пересчитывает inset после перехода', () => {
    const properties = new Map<string, string>()
    const events = new Map<string, () => void>()
    const app = {
      initData: 'signed', platform: 'ios', colorScheme: 'light' as const,
      viewportStableHeight: 780,
      isFullscreen: false,
      safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(),
      disableVerticalSwipes: vi.fn(), requestFullscreen: vi.fn(), exitFullscreen: vi.fn(),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
      onEvent: vi.fn((event: string, handler: () => void) => events.set(event, handler)),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: vi.fn() },
        style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      },
    })

    initTelegram()
    expect(app.exitFullscreen).not.toHaveBeenCalled()

    app.isFullscreen = true
    events.get('fullscreenChanged')?.()
    events.get('fullscreenChanged')?.()

    expect(app.exitFullscreen).not.toHaveBeenCalled()
    expect(properties.get('--tg-js-safe-top')).toBe('88px')
    expect(app.expand).not.toHaveBeenCalled()
  })

  it('защищает нативную строку Telegram в fullscreen iPhone до прихода inset', () => {
    const properties = new Map<string, string>()
    const app = {
      initData: 'signed', platform: 'ios', colorScheme: 'light' as const,
      viewportStableHeight: 900, isExpanded: true, isFullscreen: true,
      safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(), disableVerticalSwipes: vi.fn(),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), onEvent: vi.fn(),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app, WebView: { postEvent: vi.fn() } } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: vi.fn() },
        style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      },
    })

    initTelegram()
    expect(properties.get('--tg-js-safe-top')).toBe('88px')
  })

  it('складывает device и content inset вместо выбора большего', () => {
    const properties = new Map<string, string>()
    const app = {
      initData: 'signed', platform: 'ios', colorScheme: 'light' as const,
      viewportStableHeight: 900, isExpanded: true, isFullscreen: true,
      safeAreaInset: { top: 59, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
      ready: vi.fn(), expand: vi.fn(), close: vi.fn(), disableVerticalSwipes: vi.fn(),
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), onEvent: vi.fn(),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app, WebView: { postEvent: vi.fn() } } })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { add: vi.fn() },
        style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      },
    })

    initTelegram()
    expect(properties.get('--tg-js-safe-top')).toBe('105px')
    expect(properties.get('--tg-js-safe-bottom')).toBe('34px')
  })

  it('передаёт BackButton текущему экрану и снимает обработчик', () => {
    const back = vi.fn()
    const button = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() }
    vi.stubGlobal('window', { Telegram: { WebApp: { platform: 'ios', BackButton: button } } })

    const cleanup = setBackButton(true, back)
    expect(button.onClick).toHaveBeenCalledWith(back)
    expect(button.show).toHaveBeenCalledOnce()
    cleanup()
    expect(button.offClick).toHaveBeenCalledWith(back)
    expect(button.hide).toHaveBeenCalledOnce()
  })

  it('даёт тик выбора и откатывается на light impact в старом Telegram', () => {
    const selectionChanged = vi.fn()
    const impactOccurred = vi.fn()
    vi.stubGlobal('window', { Telegram: { WebApp: { HapticFeedback: { selectionChanged, impactOccurred } } } })
    haptics.selection()
    expect(selectionChanged).toHaveBeenCalledOnce()
    expect(impactOccurred).not.toHaveBeenCalled()

    vi.stubGlobal('window', { Telegram: { WebApp: { HapticFeedback: { impactOccurred } } } })
    haptics.selection()
    expect(impactOccurred).toHaveBeenCalledWith('light')
  })

  it('синхронизирует цвет нативной шапки с темой приложения', () => {
    const app = {
      initData: 'signed', platform: 'ios', colorScheme: 'dark' as const,
      setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
    }
    vi.stubGlobal('window', { Telegram: { WebApp: app } })

    syncTelegramTheme('system')
    expect(app.setHeaderColor).toHaveBeenLastCalledWith('#1c201d')
    syncTelegramTheme('light')
    expect(app.setHeaderColor).toHaveBeenLastCalledWith('#ffffff')
    syncTelegramTheme('dark')
    expect(app.setBackgroundColor).toHaveBeenLastCalledWith('#1c201d')
  })
})
