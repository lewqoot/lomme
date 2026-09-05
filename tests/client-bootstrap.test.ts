import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, API_TIMEOUT_MS, authenticate } from '../src/lib/api.js'

const productionHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const previewHtml = readFileSync(new URL('../design-preview.html', import.meta.url), 'utf8')

describe('клиентский запуск', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('не блокирует HTML parser загрузкой Telegram SDK', () => {
    expect(productionHtml).toMatch(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/)
    expect(previewHtml).toMatch(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/)
  })

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

  it('прерывает зависший API-запрос и сообщает тайм-аут', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))

    const request = expect(api('/slow')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: 408 })
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)

    await request
  })
})
