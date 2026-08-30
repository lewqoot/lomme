import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToForeground } from '../src/lib/foreground-sync.js'

describe('обновление после нативной команды', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('обновляет данные при возврате в Telegram и снимает все слушатели', () => {
    const windowHandlers = new Map<string, EventListener>()
    const documentHandlers = new Map<string, EventListener>()
    const telegramHandlers = new Map<string, () => void>()
    const removeWindow = vi.fn()
    const removeDocument = vi.fn()
    const offEvent = vi.fn()
    const refresh = vi.fn()

    vi.stubGlobal('window', {
      addEventListener: (event: string, handler: EventListener) => windowHandlers.set(event, handler),
      removeEventListener: removeWindow,
      Telegram: { WebApp: { onEvent: (event: string, handler: () => void) => telegramHandlers.set(event, handler), offEvent } },
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (event: string, handler: EventListener) => documentHandlers.set(event, handler),
      removeEventListener: removeDocument,
    })

    const cleanup = subscribeToForeground(refresh, 0)
    windowHandlers.get('focus')!(new Event('focus'))
    documentHandlers.get('visibilitychange')!(new Event('visibilitychange'))
    telegramHandlers.get('activated')!()

    expect(refresh).toHaveBeenCalledTimes(3)
    cleanup()
    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(offEvent).toHaveBeenCalledWith('activated', expect.any(Function))
  })

  it('не делает запрос, пока приложение скрыто', () => {
    let visibilityHandler: EventListener | undefined
    const refresh = vi.fn()
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: (_event: string, handler: EventListener) => { visibilityHandler = handler },
      removeEventListener: vi.fn(),
    })

    subscribeToForeground(refresh, 0)
    visibilityHandler!(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
