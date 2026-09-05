import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('Lomme API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    process.env.ALLOW_DEV_AUTH = 'true'
    app = await buildApp(new MemoryFinanceStore())
  })
  afterEach(async () => { await app.close() })

  async function login() {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers['set-cookie']!
    return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';')[0]
  }

  it('не отдаёт финансовые данные без сессии', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/snapshot' })
    expect(response.statusCode).toBe(401)
  })

  it('сжимает JSON API, когда клиент поддерживает gzip', async () => {
    const cookie = await login()
    const response = await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie, 'accept-encoding': 'gzip' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-encoding']).toBe('gzip')
  })

  it('выдаёт CORS credentials только доверенному origin', async () => {
    const cookie = await login()
    const allowed = await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie, origin: 'https://lomme.example' } })
    expect(allowed.headers['access-control-allow-origin']).toBe('https://lomme.example')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')

    const rejected = await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie, origin: 'https://evil.example' } })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined()
    expect(rejected.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('создаёт операцию идемпотентно и считает баланс', async () => {
    const cookie = await login()
    const snapshot = await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })
    const data = snapshot.json()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const payload = { workspaceId: data.activeWorkspaceId, type: 'expense', amountKopecks: 12345, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString(), note: 'Тест', source: 'manual' }
    const headers = { cookie, 'idempotency-key': 'same-operation' }
    const first = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers, payload })
    const second = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers, payload })
    expect(first.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)

    const mismatched = await app.inject({
      method: 'POST', url: '/api/v1/transactions', headers,
      payload: { ...payload, amountKopecks: payload.amountKopecks + 1 },
    })
    expect(mismatched.statusCode).toBe(409)
    expect(mismatched.json().error.code).toBe('VERSION_CONFLICT')
  })

  it('принимает ключ категории длиннее 16 символов', async () => {
    const cookie = await login()
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { cookie },
      payload: {
        workspaceId: snapshot.activeWorkspaceId,
        type: 'income',
        name: 'Инвестиционный доход',
        icon: 'chart-no-axes-combined',
        color: '#159B61',
      },
    })

    expect(response.statusCode).toBe(201)

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { cookie },
      payload: {
        workspaceId: snapshot.activeWorkspaceId,
        type: 'income',
        name: 'Слишком длинный ключ',
        icon: 'x'.repeat(33),
        color: '#159B61',
      },
    })
    expect(rejected.statusCode).toBe(400)
  })

  it('создаёт и редактирует вложенную категорию, затем сохраняет порядок', async () => {
    const cookie = await login()
    const before = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const parentResponse = await app.inject({
      method: 'POST', url: '/api/v1/categories', headers: { cookie },
      payload: { workspaceId: before.activeWorkspaceId, type: 'expense', name: 'Дом', icon: 'house', color: '#6B6B6B', parentId: null },
    })
    expect(parentResponse.statusCode).toBe(201)
    const parentId = parentResponse.json().id
    const childResponse = await app.inject({
      method: 'POST', url: '/api/v1/categories', headers: { cookie },
      payload: { workspaceId: before.activeWorkspaceId, type: 'expense', name: 'Свет', icon: 'zap', color: '#EAB308', parentId },
    })
    expect(childResponse.statusCode).toBe(201)
    const childId = childResponse.json().id

    const update = await app.inject({
      method: 'PUT', url: `/api/v1/categories/${childId}`, headers: { cookie },
      payload: { type: 'expense', name: 'Электричество', icon: 'zap', color: '#EAB308', parentId, version: 1 },
    })
    expect(update.statusCode).toBe(204)

    const middle = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const expenseIds = middle.categories.filter((item: { type: string; archivedAt: string | null }) => item.type === 'expense' && !item.archivedAt).map((item: { id: string }) => item.id).reverse()
    const reorder = await app.inject({
      method: 'PUT', url: '/api/v1/categories/reorder', headers: { cookie },
      payload: { workspaceId: before.activeWorkspaceId, type: 'expense', categoryIds: expenseIds },
    })
    expect(reorder.statusCode).toBe(204)

    const after = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const child = after.categories.find((item: { id: string }) => item.id === childId)
    expect(child).toMatchObject({ name: 'Электричество', parentId, order: expenseIds.indexOf(childId) })
    expect(after.categories.filter((item: { type: string; archivedAt: string | null }) => item.type === 'expense' && !item.archivedAt).map((item: { id: string }) => item.id)).toEqual(expenseIds)

    const parent = after.categories.find((item: { id: string }) => item.id === parentId)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/categories/${parentId}?version=${parent.version}`, headers: { cookie } })).statusCode).toBe(204)
    const afterArchive = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    expect(afterArchive.categories.find((item: { id: string }) => item.id === childId).parentId).toBeNull()
  })

  it('возвращает 409 при сохранении устаревшей версии', async () => {
    const cookie = await login()
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const transaction = snapshot.transactions[0]
    const payload = { type: transaction.type, amountKopecks: transaction.amountKopecks, accountId: transaction.accountId, targetAccountId: transaction.targetAccountId, categoryId: transaction.categoryId, occurredAt: transaction.occurredAt, note: 'Изменено', version: transaction.version }
    expect((await app.inject({ method: 'PUT', url: `/api/v1/transactions/${transaction.id}`, headers: { cookie }, payload })).statusCode).toBe(204)
    expect((await app.inject({ method: 'PUT', url: `/api/v1/transactions/${transaction.id}`, headers: { cookie }, payload })).statusCode).toBe(409)
  })

})
