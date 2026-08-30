import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('cursor журнала', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let cookie: string

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    process.env.ALLOW_DEV_AUTH = 'true'
    app = await buildApp(new MemoryFinanceStore())
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
    const raw = auth.headers['set-cookie']!
    cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]!
  })

  afterEach(async () => app.close())

  it('страницами возвращает весь период без повторов', async () => {
    const initial = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const accountId = initial.accounts[0].id
    const categoryId = initial.categories.find((item: { type: string }) => item.type === 'expense').id
    for (let index = 0; index < 35; index += 1) {
      const created = await app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: { cookie, 'idempotency-key': `cursor-${index}` },
        payload: { workspaceId: initial.activeWorkspaceId, type: 'expense', amountKopecks: 100 + index, accountId, categoryId, occurredAt: new Date(Date.now() - index * 1_000).toISOString(), note: '', source: 'manual' },
      })
      expect(created.statusCode).toBe(201)
    }

    const first = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    expect(first.transactions).toHaveLength(20)
    expect(first.transactionsNextCursor).toEqual(expect.any(String))

    const all = [...first.transactions]
    let cursor: string | null = first.transactionsNextCursor
    while (cursor) {
      const query = new URLSearchParams({ workspaceId: first.activeWorkspaceId, cursor, limit: '20' })
      const response = await app.inject({ method: 'GET', url: `/api/v1/transactions?${query}`, headers: { cookie } })
      expect(response.statusCode).toBe(200)
      const page = response.json()
      all.push(...page.items)
      cursor = page.nextCursor
    }

    expect(new Set(all.map((item: { id: string }) => item.id)).size).toBe(all.length)
    expect(all.length).toBeGreaterThanOrEqual(44)
  })

  it('отклоняет подменённый cursor', async () => {
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const response = await app.inject({ method: 'GET', url: `/api/v1/transactions?workspaceId=${snapshot.activeWorkspaceId}&cursor=broken`, headers: { cookie } })
    expect(response.statusCode).toBe(400)
  })

  it('создаёт достаточно доходных категорий для горизонтального листания', async () => {
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    expect(snapshot.categories.filter((item: { type: string }) => item.type === 'income').length).toBeGreaterThanOrEqual(8)
  })
})
