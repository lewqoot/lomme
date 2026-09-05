import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('повтор быстрого ввода', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore
  let key: string
  let userId: string

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
    const session = await store.createSession(
      { id: 501, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    userId = session.user.id
    key = (await store.issueQuickKey(userId)).key
  })

  afterEach(async () => { await app.close() })

  const run = (q: string, runId?: string) => app.inject({
    method: 'GET',
    url: `/api/v1/quick?q=${encodeURIComponent(q)}${runId ? `&run=${runId}` : ''}`,
    headers: { authorization: `Bearer ${key}` },
  })

  const expenses = async () => (await store.snapshot(userId)).transactions.filter((entry) => entry.note === 'такси')

  it('повтор одного запуска не создаёт вторую трату', async () => {
    const first = await run('300 такси', 'run-abc12345')
    const second = await run('300 такси', 'run-abc12345')

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.body).toBe(first.body)
    expect(await expenses()).toHaveLength(1)
  })

  it('две настоящие покупки на одну сумму остаются двумя', async () => {
    await run('300 такси', 'run-morning01')
    await run('300 такси', 'run-evening01')

    expect(await expenses()).toHaveLength(2)
  })

  it('без идентификатора запуска поведение прежнее', async () => {
    await run('300 такси')
    await run('300 такси')

    expect(await expenses()).toHaveLength(2)
  })

  it('идентификатор принимается и заголовком', async () => {
    const send = () => app.inject({
      method: 'POST', url: '/api/v1/quick',
      headers: { authorization: `Bearer ${key}`, 'idempotency-key': 'run-header-01' },
      payload: { amount: '300', text: 'такси' },
    })

    const first = await send()
    const second = await send()

    expect(first.json().id).toBe(second.json().id)
    expect(await expenses()).toHaveLength(1)
  })

  it('ответ быстрого ввода не кешируется', async () => {
    const response = await run('300 такси', 'run-nocache01')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('мусорный идентификатор игнорируется, а не ломает запись', async () => {
    const response = await run('300 такси', 'x')

    expect(response.statusCode).toBe(200)
    expect(await expenses()).toHaveLength(1)
  })
})
