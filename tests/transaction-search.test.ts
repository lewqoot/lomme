import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('серверный поиск операций', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore
  let ownerCookie: string
  let outsiderCookie: string

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    store = new MemoryFinanceStore()
    const owner = await store.createSession({ id: 7201, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const outsider = await store.createSession({ id: 7202, firstName: 'Ирина', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    ownerCookie = `lomme_session=${owner.token}`
    outsiderCookie = `lomme_session=${outsider.token}`
    app = await buildApp(store)
  })

  afterEach(async () => app.close())

  const snapshot = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()

  async function addExpense(cookie: string, data: { workspaceId: string; accountId: string; categoryId: string; note: string; occurredAt: string }, key: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: { cookie, 'idempotency-key': key },
      payload: { ...data, type: 'expense', amountKopecks: 12_345, targetAccountId: null, source: 'manual' },
    })
    expect(response.statusCode).toBe(201)
    return response.json().id as string
  }

  it('находит запись за первой страницей и перелистывает все совпадения', async () => {
    const initial = await snapshot(ownerCookie)
    const accountId = initial.accounts[0].id as string
    const categoryId = initial.categories.find((item: { type: string }) => item.type === 'expense').id as string
    let hiddenId = ''
    for (let index = 0; index < 25; index += 1) {
      const note = index === 24 ? 'Редкий маяк покупка' : `Обычная покупка ${index}`
      const id = await addExpense(ownerCookie, {
        workspaceId: initial.activeWorkspaceId,
        accountId,
        categoryId,
        note,
        occurredAt: new Date(Date.UTC(2026, 8, 25, 12, 0, 0) - index * 60_000).toISOString(),
      }, `search-${index}`)
      if (index === 24) hiddenId = id
    }

    const firstJournal = await snapshot(ownerCookie)
    expect(firstJournal.transactions).toHaveLength(20)
    expect(firstJournal.transactions.some((item: { id: string }) => item.id === hiddenId)).toBe(false)

    const base = new URLSearchParams({
      workspaceId: initial.activeWorkspaceId,
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-30T23:59:59.999Z',
      query: 'редкий маяк',
      limit: '10',
    })
    const result = await app.inject({ method: 'GET', url: `/api/v1/transactions/search?${base}`, headers: { cookie: ownerCookie } })
    expect(result.statusCode).toBe(200)
    expect(result.json().items.map((item: { id: string }) => item.id)).toEqual([hiddenId])

    base.set('query', 'покупка')
    const seen: string[] = []
    let cursor: string | null = null
    do {
      if (cursor) base.set('cursor', cursor)
      else base.delete('cursor')
      const page = (await app.inject({ method: 'GET', url: `/api/v1/transactions/search?${base}`, headers: { cookie: ownerCookie } })).json()
      seen.push(...page.items.map((item: { id: string }) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
  })

  it('соблюдает область кошелька и не возвращает операции другого пользователя', async () => {
    const owner = await snapshot(ownerCookie)
    const outsider = await snapshot(outsiderCookie)
    const ownerCategoryId = owner.categories.find((item: { type: string }) => item.type === 'expense').id as string
    const outsiderCategoryId = outsider.categories.find((item: { type: string }) => item.type === 'expense').id as string
    const reserve = (await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: { cookie: ownerCookie },
      payload: { workspaceId: owner.activeWorkspaceId, name: 'Резерв', kind: 'cash', icon: 'wallet', color: '#DDF146', openingBalanceKopecks: 0 },
    })).json()
    const reserveId = await addExpense(ownerCookie, { workspaceId: owner.activeWorkspaceId, accountId: reserve.id, categoryId: ownerCategoryId, note: 'Общая метка', occurredAt: '2026-09-10T12:00:00.000Z' }, 'reserve')
    await addExpense(outsiderCookie, { workspaceId: outsider.activeWorkspaceId, accountId: outsider.accounts[0].id, categoryId: outsiderCategoryId, note: 'Общая метка секрет', occurredAt: '2026-09-10T12:00:00.000Z' }, 'outsider')

    const query = new URLSearchParams({ workspaceId: owner.activeWorkspaceId, accountId: reserve.id, start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z', query: 'общая метка' })
    const result = await app.inject({ method: 'GET', url: `/api/v1/transactions/search?${query}`, headers: { cookie: ownerCookie } })
    expect(result.statusCode).toBe(200)
    expect(result.json().items.map((item: { id: string }) => item.id)).toEqual([reserveId])

    query.set('query', 'резерв')
    const byAccount = await app.inject({ method: 'GET', url: `/api/v1/transactions/search?${query}`, headers: { cookie: ownerCookie } })
    expect(byAccount.json().items.map((item: { id: string }) => item.id)).toEqual([reserveId])

    query.set('workspaceId', outsider.activeWorkspaceId)
    query.delete('accountId')
    const forbidden = await app.inject({ method: 'GET', url: `/api/v1/transactions/search?${query}`, headers: { cookie: ownerCookie } })
    expect(forbidden.statusCode).toBe(403)
  })
})
