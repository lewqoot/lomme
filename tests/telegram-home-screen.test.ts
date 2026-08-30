/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import { addHomeScreenShortcut, checkHomeScreenShortcut, onHomeScreenAdded } from '../src/lib/telegram.js'

describe('Telegram home screen shortcut', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('проверяет статус ярлыка в Telegram', async () => {
    vi.stubGlobal('window', telegramWindow({
      addToHomeScreen: vi.fn(),
      checkHomeScreenStatus: (callback?: (status: 'missed') => void) => callback?.('missed'),
    }))

    await expect(checkHomeScreenShortcut()).resolves.toBe('missed')
  })

  it('запрашивает добавление только внутри Telegram', () => {
    const addToHomeScreen = vi.fn()
    vi.stubGlobal('window', telegramWindow({ addToHomeScreen }))

    expect(addHomeScreenShortcut()).toBe(true)
    expect(addToHomeScreen).toHaveBeenCalledOnce()

    vi.stubGlobal('window', {})
    expect(addHomeScreenShortcut()).toBe(false)
  })

  it('подписывается на подтверждение Telegram и снимает подписку', () => {
    const handlers = new Map<string, () => void>()
    const onEvent = vi.fn((event: string, handler: () => void) => handlers.set(event, handler))
    const offEvent = vi.fn((event: string) => handlers.delete(event))
    const listener = vi.fn()
    vi.stubGlobal('window', telegramWindow({ onEvent, offEvent }))

    const unsubscribe = onHomeScreenAdded(listener)
    handlers.get('homeScreenAdded')?.()
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    expect(offEvent).toHaveBeenCalledOnce()
  })

  it('возвращает unsupported вне Telegram', async () => {
    vi.stubGlobal('window', {})
    await expect(checkHomeScreenShortcut()).resolves.toBe('unsupported')
  })
})

function telegramWindow(webApp: Record<string, unknown>) {
  return {
    Telegram: {
      WebApp: {
        initData: '',
        platform: 'ios',
        colorScheme: 'light',
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
        ...webApp,
      },
    },
  }
}
