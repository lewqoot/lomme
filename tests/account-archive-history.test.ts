import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('wallet archive history', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    process.env.TELEGRAM_BOT_TOKEN = ''
    store = new MemoryFinanceStore()
    app = await buildApp(store)
  })

  afterEach(async () => { await app.close() })

  async function session(id: number, firstName: string) {
    const result = await store.createSession({ id, firstName, lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    return { ...result, cookie: `lomme_session=${result.token}` }
  }

  it('keeps archived expenses in reports and lets the owner inspect and restore the wallet', async () => {
    const owner = await session(5101, 'Алекс')
    const initial = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const created = (await app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: { cookie: owner.cookie },
      payload: { workspaceId: initial.activeWorkspaceId, name: 'Поездка', kind: 'cash', openingBalanceKopecks: 0 },
    })).json()
    const active = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const category = active.categories.find((item: { type: string; archivedAt: string | null }) => item.type === 'expense' && !item.archivedAt)
    const occurredAt = '2026-09-05T10:00:00.000Z'
    const range = `start=2026-09-01T00:00:00.000Z&end=2026-09-30T23:59:59.999Z`
    expect((await app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: { cookie: owner.cookie, 'idempotency-key': 'archive-history-expense' },
      payload: { workspaceId: initial.activeWorkspaceId, type: 'expense', amountKopecks: 300, accountId: created.id, categoryId: category.id, occurredAt, note: 'Архивная покупка', source: 'manual' },
    })).statusCode).toBe(201)

    const before = (await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${initial.activeWorkspaceId}&accountId=all&${range}`, headers: { cookie: owner.cookie } })).json()
    expect(before.transactions.some((item: { note: string }) => item.note === 'Архивная покупка')).toBe(true)
    const account = before.accounts.find((item: { id: string }) => item.id === created.id)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${created.id}?version=${account.version}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)

    const after = (await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${initial.activeWorkspaceId}&accountId=all&${range}`, headers: { cookie: owner.cookie } })).json()
    const archived = after.accounts.find((item: { id: string }) => item.id === created.id)
    expect(archived).toMatchObject({ name: 'Поездка', version: account.version + 1 })
    expect(archived.archivedAt).toBeTruthy()
    expect(after.summary.expenseKopecks).toBe(before.summary.expenseKopecks)
    expect(after.transactions.some((item: { note: string }) => item.note === 'Архивная покупка')).toBe(true)

    const archivedView = await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${initial.activeWorkspaceId}&accountId=${created.id}&${range}`, headers: { cookie: owner.cookie } })
    expect(archivedView.statusCode).toBe(200)
    expect(archivedView.json().summary.expenseKopecks).toBe(300)
    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/active-account', headers: { cookie: owner.cookie }, payload: { workspaceId: initial.activeWorkspaceId, accountId: created.id } })).statusCode).toBe(403)
    expect((await app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: { cookie: owner.cookie, 'idempotency-key': 'archived-write' },
      payload: { workspaceId: initial.activeWorkspaceId, type: 'expense', amountKopecks: 100, accountId: created.id, categoryId: category.id, occurredAt, note: '', source: 'manual' },
    })).statusCode).toBe(403)

    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/${created.id}/restore?version=${archived.version}`, headers: { cookie: owner.cookie }, payload: {} })).statusCode).toBe(204)
    const restored = (await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${initial.activeWorkspaceId}&accountId=${created.id}&${range}`, headers: { cookie: owner.cookie } })).json()
    expect(restored.accounts.find((item: { id: string }) => item.id === created.id)).toMatchObject({ archivedAt: null, version: archived.version + 1 })
    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/active-account', headers: { cookie: owner.cookie }, payload: { workspaceId: initial.activeWorkspaceId, accountId: created.id } })).statusCode).toBe(204)
  })

  it('does not expose an archived shared wallet to an editor', async () => {
    process.env.TELEGRAM_BOT_USERNAME = 'lomme_test_bot'
    const owner = await session(5201, 'Алекс')
    const guest = await session(5202, 'Ирина')
    const initial = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const created = (await app.inject({ method: 'POST', url: '/api/v1/accounts', headers: { cookie: owner.cookie }, payload: { workspaceId: initial.activeWorkspaceId, name: 'Общий архив', kind: 'cash', openingBalanceKopecks: 0 } })).json()
    const invite = (await app.inject({ method: 'POST', url: `/api/v1/accounts/${created.id}/invites`, headers: { cookie: owner.cookie }, payload: { role: 'editor' } })).json()
    expect((await app.inject({ method: 'POST', url: '/api/v1/account-invites/accept', headers: { cookie: guest.cookie }, payload: { token: invite.token } })).statusCode).toBe(200)
    const ownerSnapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const account = ownerSnapshot.accounts.find((item: { id: string }) => item.id === created.id)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${created.id}?version=${account.version}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)

    expect((await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${initial.activeWorkspaceId}&accountId=${created.id}`, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    const guestSnapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: guest.cookie } })).json()
    expect(guestSnapshot.accounts.some((item: { id: string }) => item.id === created.id)).toBe(false)
  })
})
