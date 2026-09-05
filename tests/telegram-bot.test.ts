import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { routeUpdate, type RouterContext } from '../server/telegram/router.js'

const APP_URL = 'https://lomme.example'

function context(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    appUrl: APP_URL,
    noteBotContact: async () => ({ known: false }),
    resolveInvite: async () => null,
    ...overrides,
  }
}

const privateMessage = (text: string, from = 500) => ({
  update_id: 1,
  message: { text, chat: { id: 900, type: 'private' }, from: { id: from } },
})

describe('bot router', () => {
  it('приветствует новичка и предлагает открыть приложение', async () => {
    const action = await routeUpdate(privateMessage('/start'), context())

    expect(action).toMatchObject({ kind: 'send', chatId: 900 })
    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Привет! Я Lomme')
    expect(action.message.keyboard?.[0]?.[0]).toEqual({ text: 'Открыть Lomme', web_app: { url: APP_URL } })
  })

  it('узнаёт того, кто уже пользуется приложением', async () => {
    const action = await routeUpdate(privateMessage('/start'), context({ noteBotContact: async () => ({ known: true }) }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toBe('С возвращением 👋')
  })

  it('запоминает право писать по нажатию /start', async () => {
    const seen: number[] = []
    await routeUpdate(privateMessage('/start', 777), context({
      noteBotContact: async (id) => { seen.push(id); return { known: false } },
    }))

    expect(seen).toEqual([777])
  })

  it('прячет кнопку приложения, когда адрес не https', async () => {
    const action = await routeUpdate(privateMessage('/start'), context({ appUrl: null }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(JSON.stringify(action.message.keyboard)).not.toContain('web_app')
    expect(action.message.keyboard?.[0]?.[0]).toMatchObject({ callback_data: 'help' })
  })

  it('отвечает справкой на команду и на кнопку', async () => {
    const byCommand = await routeUpdate(privateMessage('/help'), context())
    const byButton = await routeUpdate({
      update_id: 2,
      callback_query: { id: 'cb-1', data: 'help', message: { chat: { id: 900 }, message_id: 5 } },
    }, context())

    if (byCommand.kind !== 'send' || byButton.kind !== 'answer') throw new Error('неожиданные действия')
    expect(byCommand.message.text).toContain('Как со мной работать')
    expect(byButton.callbackQueryId).toBe('cb-1')
    expect(byButton.message.text).toContain('Как со мной работать')
  })

  it('подставляет название кошелька в приглашение', async () => {
    const token = 'a'.repeat(32)
    const action = await routeUpdate(privateMessage(`/start invite_${token}`), context({
      resolveInvite: async () => ({ accountName: 'Семья', url: `https://t.me/lomme_bot?startapp=invite_${token}` }),
    }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Тебя зовут в общий кошелёк «Семья»')
    expect(action.message.keyboard?.[0]?.[0]).toMatchObject({ text: 'Открыть приглашение' })
  })

  it('объясняет протухшее приглашение вместо молчания', async () => {
    const action = await routeUpdate(privateMessage(`/start invite_${'b'.repeat(32)}`), context())

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('уже не работает')
  })

  it('молчит в группах и на пустых апдейтах', async () => {
    const group = await routeUpdate({
      update_id: 3,
      message: { text: '/start', chat: { id: -100, type: 'supergroup' }, from: { id: 1 } },
    }, context())
    const empty = await routeUpdate({ update_id: 4 }, context())

    expect(group).toEqual({ kind: 'none' })
    expect(empty).toEqual({ kind: 'none' })
  })
})

describe('bot webhook', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = APP_URL
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    await app.close()
  })

  function telegramReturning(status: number, body: unknown) {
    const calls: string[] = []
    const mock = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', mock)
    return calls
  }

  const deliver = (updateId: number) => app.inject({
    method: 'POST',
    url: '/api/v1/telegram/webhook/webhook-secret',
    payload: { update_id: updateId, message: { text: '/start', chat: { id: 900, type: 'private' }, from: { id: 777 } } },
  })

  it('отвечает на /start один раз, даже когда Telegram повторяет апдейт', async () => {
    const calls = telegramReturning(200, { ok: true, result: { message_id: 1 } })

    expect((await deliver(10)).statusCode).toBe(200)
    expect((await deliver(10)).statusCode).toBe(200)

    expect(calls.filter((url) => url.endsWith('/sendMessage'))).toHaveLength(1)
  })

  it('не просит Telegram повторить, когда бота заблокировали', async () => {
    telegramReturning(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })

    const response = await deliver(11)

    expect(response.statusCode).toBe(200)
  })

  it('возвращает апдейт в оборот после временной ошибки', async () => {
    telegramReturning(500, { ok: false, description: 'Internal Server Error' })
    expect((await deliver(12)).statusCode).toBe(502)

    const calls = telegramReturning(200, { ok: true, result: { message_id: 2 } })
    expect((await deliver(12)).statusCode).toBe(200)

    expect(calls.filter((url) => url.endsWith('/sendMessage'))).toHaveLength(1)
  })

  it('отмечает, что боту можно писать, когда человек уже завёл аккаунт', async () => {
    telegramReturning(200, { ok: true, result: { message_id: 3 } })
    await store.createSession({ id: 777, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')

    await deliver(13)

    expect(await store.noteBotContact(777)).toEqual({ known: true })
  })

  it('прячет вебхук за секретом', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/telegram/webhook/wrong-secret', payload: { update_id: 14 },
    })

    expect(response.statusCode).toBe(404)
  })
})
