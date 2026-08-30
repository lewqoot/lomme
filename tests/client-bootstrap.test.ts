import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticate } from '../src/lib/api.js'

describe('клиентский запуск', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('не перезапускает Telegram viewport во время авторизации', async () => {
    const webApp = { initData: 'signed-launch', ready: vi.fn(), expand: vi.fn(), close: vi.fn(), colorScheme: 'light' as const }
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'user' }) })
    vi.stubGlobal('window', { Telegram: { WebApp: webApp } })
    vi.stubGlobal('fetch', fetch)

    await authenticate()

    expect(webApp.ready).not.toHaveBeenCalled()
    expect(webApp.expand).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/telegram', expect.objectContaining({ method: 'POST' }))
  })
})
