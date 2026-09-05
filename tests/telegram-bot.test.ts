import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { routeUpdate, type RouterContext } from '../server/telegram/router.js'

const APP_URL = 'https://lomme.example'
/** Любой валидный uuid: роутер проверяет форму callback_data. */
const TX = '11111111-2222-3333-4444-555555555555'

function context(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    links: { appUrl: APP_URL, botUsername: 'lomme_test_bot' },
    noteBotContact: async () => ({ known: false }),
    resolveInvite: async () => null,
    categoryChoices: async () => null,
    correctCategory: async () => null,
    deleteEntry: async () => null,
    recordEntry: async () => ({ status: 'recorded', entry: { id: TX, categoryName: 'Продукты', categoryGuessed: false, amountKopecks: 320_000 } }),
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
    expect(action.message.text).toContain('С возвращением')
  })

  it('запоминает право писать по нажатию /start', async () => {
    const seen: number[] = []
    await routeUpdate(privateMessage('/start', 777), context({
      noteBotContact: async (id) => { seen.push(id); return { known: false } },
    }))

    expect(seen).toEqual([777])
  })

  it('ведёт кнопками на конкретные экраны, а не просто в приложение', async () => {
    const action = await routeUpdate(privateMessage('/start'), context())

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    const links = action.message.keyboard!.flat().map((button) => 'url' in button ? button.url : null).filter(Boolean)
    expect(links).toEqual([
      'https://t.me/lomme_test_bot?startapp=shortcut&mode=fullscreen',
      'https://t.me/lomme_test_bot?startapp=notifications&mode=fullscreen',
    ])
  })

  it('прячет кнопки, которым некуда вести', async () => {
    // Локальный запуск: адрес не https, а имя бота ещё не получено.
    const action = await routeUpdate(privateMessage('/start'), context({ links: { appUrl: null, botUsername: null } }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(JSON.stringify(action.message.keyboard)).not.toContain('web_app')
    expect(action.message.keyboard).toEqual([[{ text: 'Как это работает', callback_data: 'help' }]])
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

  it('записывает трату, написанную в чат', async () => {
    const seen: Array<[number, string, string]> = []
    const action = await routeUpdate(privateMessage('3200 продукты', 777), context({
      recordEntry: async (id, amount, text) => {
        seen.push([id, amount, text])
        return { status: 'recorded', entry: { id: TX, categoryName: 'Продукты', categoryGuessed: false, amountKopecks: 320_000 } }
      },
    }))

    expect(seen).toEqual([[777, '3200', 'продукты']])
    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toMatch(/^✅ Записано 3\s200 ₽\nПродукты$/u)
  })

  it('честно помечает угаданную категорию', async () => {
    const action = await routeUpdate(privateMessage('пятёрочка 2340'), context({
      recordEntry: async () => ({ status: 'recorded', entry: { id: TX, categoryName: 'Продукты', categoryGuessed: true, amountKopecks: 234_000 } }),
    }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Продукты — если не туда, поправь')
  })

  it('записывает без категории, когда подобрать не вышло', async () => {
    const action = await routeUpdate(privateMessage('1900 подарок жене'), context({
      recordEntry: async () => ({ status: 'recorded', entry: { id: TX, categoryName: null, categoryGuessed: false, amountKopecks: 190_000 } }),
    }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Без категории')
  })

  it('подсказывает формат, когда число есть, но суммой быть не может', async () => {
    // Ни в начале, ни в конце строки — разобрать нечего, но человек явно пытался.
    const action = await routeUpdate(privateMessage('встреча в 5 утра'), context({
      recordEntry: async () => { throw new Error('до записи дойти не должно') },
    }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Не нашёл сумму')
  })

  it('на обычную фразу без цифр не жалуется на сумму', async () => {
    const action = await routeUpdate(privateMessage('привет'), context())

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Я записываю траты')
    expect(action.message.text).not.toContain('Не нашёл сумму')
  })

  it('зовёт открыть приложение того, у кого ещё нет кошелька', async () => {
    const action = await routeUpdate(privateMessage('450 кофе'), context({
      recordEntry: async () => ({ status: 'no-account' }),
    }))

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('ещё не открывал приложение')
  })

  it('отвечает на голосовое вместо молчания', async () => {
    const action = await routeUpdate({
      update_id: 7,
      message: { chat: { id: 900, type: 'private' }, from: { id: 500 }, voice: { duration: 4 } },
    }, context())

    if (action.kind !== 'send') throw new Error('ожидали отправку')
    expect(action.message.text).toContain('Голосовые и фото пока не разбираю')
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

  it('записывает трату из чата в тот же кошелёк, что и приложение', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const owner = await store.createSession({ id: 777, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook/webhook-secret',
      payload: { update_id: 20, message: { text: 'пятёрочка 2340', chat: { id: 900, type: 'private' }, from: { id: 777 } } },
    })

    expect(response.statusCode).toBe(200)
    expect(sent[0]).toContain('Продукты')
    const snapshot = await store.snapshot(owner.user.id)
    const recorded = snapshot.transactions.find((entry) => entry.note === 'пятёрочка')
    expect(recorded).toMatchObject({ amountKopecks: 234_000, source: 'bot', categoryGuessed: true })
  })

  it('не выдумывает кошелёк тому, кто не открывал приложение', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook/webhook-secret',
      payload: { update_id: 21, message: { text: '450 кофе', chat: { id: 901, type: 'private' }, from: { id: 999 } } },
    })

    expect(sent[0]).toContain('ещё не открывал приложение')
  })

  it('сообщает пригласившему, что к кошельку присоединились', async () => {
    const sent: Array<{ chatId: number; text: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'lomme_test_bot' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string }
      sent.push({ chatId: body.chat_id, text: body.text })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    // Пригласивший разрешил боту писать, приглашённый — нет.
    const owner = await store.createSession({ id: 111, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru', allowsWriteToPm: true }, 'Europe/Moscow')
    const guest = await store.createSession({ id: 222, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' }, 'Europe/Moscow')
    const snapshot = await store.snapshot(owner.user.id)
    const invite = await store.createAccountInvite(owner.user.id, snapshot.activeAccountId!)

    const response = await app.inject({
      method: 'POST', url: '/api/v1/account-invites/accept',
      headers: { cookie: `lomme_session=${guest.token}` },
      payload: { token: invite.token },
    })

    expect(response.statusCode).toBe(200)
    expect(sent).toEqual([{ chatId: 111, text: '🎉 Ирина присоединился к кошельку «Кошелёк»' }])
  })

  it('молчит, если пригласивший не разрешал боту писать', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const owner = await store.createSession({ id: 333, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    const guest = await store.createSession({ id: 444, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' }, 'Europe/Moscow')
    const snapshot = await store.snapshot(owner.user.id)
    const invite = await store.createAccountInvite(owner.user.id, snapshot.activeAccountId!)

    await app.inject({
      method: 'POST', url: '/api/v1/account-invites/accept',
      headers: { cookie: `lomme_session=${guest.token}` },
      payload: { token: invite.token },
    })

    expect(sent).toHaveLength(0)
  })

  it('прячет вебхук за секретом', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/telegram/webhook/wrong-secret', payload: { update_id: 14 },
    })

    expect(response.statusCode).toBe(404)
  })
})
