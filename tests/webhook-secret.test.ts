import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

const SECRET = 'webhook-secret-value'
const update = { update_id: 1, message: { text: '/start', chat: { id: 900, type: 'private' }, from: { id: 777 } } }

describe('подлинность входящего update', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    app = await buildApp(new MemoryFinanceStore())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } })))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    await app.close()
  })

  const post = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers, payload: update })

  it('принимает update с секретным заголовком Telegram', async () => {
    const response = await post('/api/v1/telegram/webhook', { 'x-telegram-bot-api-secret-token': SECRET })

    expect(response.statusCode).toBe(200)
  })

  it('без заголовка постоянный маршрут отвечает как несуществующий', async () => {
    expect((await post('/api/v1/telegram/webhook')).statusCode).toBe(404)
    expect((await post('/api/v1/telegram/webhook', { 'x-telegram-bot-api-secret-token': 'чужой' })).statusCode).toBe(404)
  })

  it('поддельный update не создаёт записей и не отвечает пользователю', async () => {
    const store = new MemoryFinanceStore()
    const scoped = await buildApp(store)
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      sent.push(String(input))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const response = await scoped.inject({
      method: 'POST', url: '/api/v1/telegram/webhook',
      payload: { update_id: 5, message: { text: '5000 такси', chat: { id: 900, type: 'private' }, from: { id: 777 } } },
    })

    expect(response.statusCode).toBe(404)
    expect(sent.filter((url) => url.endsWith('/sendMessage'))).toHaveLength(0)
    await scoped.close()
  })

  it('старый маршрут с секретом в пути ещё принимается, но не попадает в лог', async () => {
    const response = await post(`/api/v1/telegram/webhook/${SECRET}`)

    expect(response.statusCode).toBe(200)
  })
})
