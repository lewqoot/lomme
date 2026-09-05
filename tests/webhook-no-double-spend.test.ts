import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

const SECRET = 'webhook-secret-value'
const TELEGRAM_ID = 777

/** Один и тот же апдейт, как его повторяет Telegram: тот же update_id. */
const spend = (updateId: number) => ({
  update_id: updateId,
  message: { message_id: updateId, text: '300 такси', chat: { id: 900, type: 'private' }, from: { id: TELEGRAM_ID } },
})

describe('повтор апдейта не удваивает деньги', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore
  let userId: string
  let sent: string[]

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
    const session = await store.createSession(
      { id: TELEGRAM_ID, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    userId = session.user.id
    sent = []
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    await app.close()
  })

  /** Telegram, который принимает или отвергает отправку подтверждения. */
  function telegram(behaviour: 'ok' | 'fail-once' | 'throw-once') {
    let failed = false
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (!url.endsWith('/sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'lomme_test_bot' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (!failed && behaviour !== 'ok') {
        failed = true
        if (behaviour === 'throw-once') throw new Error('socket hang up')
        return new Response(JSON.stringify({ ok: false, description: 'Internal Server Error' }), { status: 500, headers: { 'content-type': 'application/json' } })
      }
      sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  }

  const deliver = (updateId: number) => app.inject({
    method: 'POST', url: '/api/v1/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': SECRET },
    payload: spend(updateId),
  })

  async function expenses() {
    const snapshot = await store.snapshot(userId)
    return snapshot.transactions.filter((entry) => entry.note === 'такси')
  }

  it('сбой отправки и повтор дают одну трату и одно подтверждение', async () => {
    telegram('fail-once')

    // Первая доставка: расход записан, подтверждение не ушло — просим повторить.
    expect((await deliver(10)).statusCode).toBe(502)
    // Повтор того же апдейта: денег больше не пишем, подтверждение досылаем.
    expect((await deliver(10)).statusCode).toBe(200)

    expect(await expenses()).toHaveLength(1)
    // Досланное подтверждение восстановлено из самой записи, вместе с пометкой
    // об угаданной категории — «такси» знает словарь сервисов.
    expect(sent).toEqual(['✅ Записано 300 ₽\nТранспорт — если не туда, поправь'])
  })

  it('третья доставка уже ничего не делает', async () => {
    telegram('fail-once')
    await deliver(11)
    await deliver(11)
    await deliver(11)

    expect(await expenses()).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('две разные траты на одну сумму остаются двумя', async () => {
    telegram('ok')

    await deliver(12)
    await deliver(13)

    expect(await expenses()).toHaveLength(2)
  })

  it('успешная доставка не повторяется при дубле', async () => {
    telegram('ok')
    await deliver(14)
    await deliver(14)

    expect(await expenses()).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })
})
