import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

const WEBHOOK = '/api/v1/telegram/webhook/webhook-secret'
const OWNER_TELEGRAM_ID = 777
const STRANGER_TELEGRAM_ID = 999

describe('правка записи кнопками', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore
  let ownerId: string
  let sent: Array<{ method: string; text: string }>
  let updateId = 100

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
    const owner = await store.createSession(
      { id: OWNER_TELEGRAM_ID, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    ownerId = owner.user.id
    await store.createSession(
      { id: STRANGER_TELEGRAM_ID, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' }, 'Europe/Moscow')

    sent = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'lomme_test_bot' } }),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const method = url.split('/').pop()!
      if (method === 'sendMessage' || method === 'editMessageText') {
        sent.push({ method, text: JSON.parse(String(init?.body)).text as string })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    await app.close()
  })

  const write = (text: string, from = OWNER_TELEGRAM_ID) => app.inject({
    method: 'POST', url: WEBHOOK,
    payload: { update_id: updateId++, message: { text, chat: { id: 900, type: 'private' }, from: { id: from } } },
  })

  const press = (data: string, from = OWNER_TELEGRAM_ID) => app.inject({
    method: 'POST', url: WEBHOOK,
    payload: {
      update_id: updateId++,
      callback_query: { id: `cb-${updateId}`, data, from: { id: from }, message: { chat: { id: 900 }, message_id: 7 } },
    },
  })

  /** Записывает трату ботом и возвращает её id и id какой-нибудь другой категории. */
  async function record(text: string) {
    await write(text)
    const snapshot = await store.snapshot(ownerId)
    const entry = snapshot.transactions[0]!
    const other = snapshot.categories.find((item) => item.type === 'expense' && item.id !== entry.categoryId)!
    sent = []
    return { id: entry.id, otherCategory: other }
  }

  it('показывает выбор категории и заменяет собой прежнее сообщение', async () => {
    const { id } = await record('пятёрочка 2340')

    await press(`cat:${id}`)

    // Правка не добавляет второй пузырь: она переписывает тот, где была кнопка.
    expect(sent[0]?.method).toBe('editMessageText')
    expect(sent[0]?.text).toBe('Куда записать?')
  })

  it('переносит запись и запоминает слово', async () => {
    const { id, otherCategory } = await record('пятёрочка 2340')

    await press(`set:${id}:${otherCategory.id.slice(0, 8)}`)

    expect(sent[0]?.text).toContain(`→ ${otherCategory.name}`)
    expect(sent[0]?.text).toContain('Запомнил: «пятерочка»')
    const snapshot = await store.snapshot(ownerId)
    expect(snapshot.transactions[0]).toMatchObject({ categoryId: otherCategory.id, categoryGuessed: false })
  })

  it('в следующий раз то же слово уходит по запомненному правилу', async () => {
    const { id, otherCategory } = await record('пятёрочка 2340')
    await press(`set:${id}:${otherCategory.id.slice(0, 8)}`)

    await write('пятёрочка 500')

    const snapshot = await store.snapshot(ownerId)
    expect(snapshot.transactions[0]).toMatchObject({ amountKopecks: 50_000, categoryId: otherCategory.id })
  })

  it('удаляет запись по кнопке', async () => {
    const { id } = await record('1900 подарок жене')

    await press(`del:${id}`)

    expect(sent[0]?.text).toContain('Удалил запись')
    const snapshot = await store.snapshot(ownerId)
    expect(snapshot.transactions.find((item) => item.id === id)).toBeUndefined()
  })

  it('не даёт чужому человеку тронуть запись', async () => {
    const { id, otherCategory } = await record('пятёрочка 2340')

    await press(`del:${id}`, STRANGER_TELEGRAM_ID)
    await press(`set:${id}:${otherCategory.id.slice(0, 8)}`, STRANGER_TELEGRAM_ID)

    expect(sent.map((item) => item.text)).toEqual(['Этой записи уже нет.', 'Этой записи уже нет.'])
    const snapshot = await store.snapshot(ownerId)
    expect(snapshot.transactions.find((item) => item.id === id)).toBeDefined()
  })

  it('честно отвечает на кнопку под удалённой записью', async () => {
    const { id } = await record('пятёрочка 2340')
    await press(`del:${id}`)
    sent = []

    await press(`cat:${id}`)

    expect(sent[0]?.text).toBe('Этой записи уже нет.')
  })

  it('отвечает новым сообщением, когда прежнее уже нельзя изменить', async () => {
    const { id } = await record('пятёрочка 2340')
    // Telegram отвечает так, когда сообщение с кнопкой удалили.
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = url.split('/').pop()!
      if (method === 'editMessageText') {
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message to edit not found' }),
          { status: 400, headers: { 'content-type': 'application/json' } })
      }
      if (method === 'sendMessage') sent.push({ method, text: JSON.parse(String(init?.body)).text as string })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 43 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const response = await press(`del:${id}`)

    // Не 502: повторять нечего, ответ доставлен другим способом.
    expect(response.statusCode).toBe(200)
    expect(sent.at(-1)).toMatchObject({ method: 'sendMessage' })
    expect(sent.at(-1)?.text).toContain('Удалил запись')
  })

  it('игнорирует испорченный callback вместо падения', async () => {
    const response = await press('set:не-uuid:zzzz')

    expect(response.statusCode).toBe(200)
    expect(sent[0]?.text).toContain('Я записываю траты')
  })
})
