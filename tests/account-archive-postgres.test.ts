import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type StorePool = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  connect(): Promise<StoreClient>
  end(): Promise<void>
}

type StoreClient = Pick<StorePool, 'query'> & { release(): void }

describe('wallet archive history in the PostgreSQL store', () => {
  let database: PGlite
  let store: PostgresFinanceStore

  beforeEach(async () => {
    database = new PGlite()
    await database.waitReady
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> }
    for (const migration of journal.entries) {
      await database.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), 'utf8'))
    }
    const query = async (sql: string, params: unknown[] = []) => {
      const result = await database.query<Record<string, unknown>>(sql, params)
      return { ...result, rowCount: result.affectedRows || result.rows.length }
    }
    const client = { query, release() {} }
    const pool: StorePool = { query, connect: async () => client, end: async () => database.close() }
    const original = (store = new PostgresFinanceStore('postgresql://unused')) as unknown as { pool: StorePool }
    await original.pool.end()
    original.pool = pool
  })

  afterEach(async () => { await store.close() })

  it('keeps the owner history in aggregate queries while hiding the archive from editors', async () => {
    const owner = await store.createSession({ id: 6101, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const guest = await store.createSession({ id: 6102, firstName: 'Ирина', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const initial = await store.snapshot(owner.user.id)
    const accountId = (await store.createAccount(owner.user.id, {
      workspaceId: initial.activeWorkspaceId,
      name: 'Поездка',
      kind: 'cash',
      icon: 'wallet',
      color: '#DDF146',
      openingBalanceKopecks: 0,
    })).id
    const invite = await store.createAccountInvite(owner.user.id, accountId)
    await store.acceptAccountInvite(guest.user.id, invite.token)
    const categoryId = initial.categories.find((item) => item.type === 'expense' && !item.archivedAt)!.id
    await store.createTransaction(owner.user.id, {
      workspaceId: initial.activeWorkspaceId,
      type: 'expense',
      amountKopecks: 300,
      accountId,
      targetAccountId: null,
      categoryId,
      occurredAt: '2026-09-05T10:00:00.000Z',
      note: 'Архивная покупка',
      source: 'manual',
    }, 'archive-postgres-expense')
    const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z' }
    const before = await store.snapshot(owner.user.id, initial.activeWorkspaceId, range, null)
    const account = before.accounts.find((item) => item.id === accountId)!

    await store.archiveAccount(owner.user.id, accountId, account.version)

    const after = await store.snapshot(owner.user.id, initial.activeWorkspaceId, range, null)
    const archived = after.accounts.find((item) => item.id === accountId)!
    expect(archived.archivedAt).toBeTruthy()
    expect(after.summary.expenseKopecks).toBe(before.summary.expenseKopecks)
    expect(after.transactions.some((item) => item.note === 'Архивная покупка')).toBe(true)
    await expect(store.snapshot(guest.user.id, initial.activeWorkspaceId, range, accountId)).rejects.toMatchObject({ statusCode: 403 })
    const archivedView = await store.snapshot(owner.user.id, initial.activeWorkspaceId, range, accountId)
    expect(archivedView.summary.expenseKopecks).toBe(300)

    await store.restoreAccount(owner.user.id, accountId, archived.version)
    const restored = await store.snapshot(owner.user.id, initial.activeWorkspaceId, range, accountId)
    expect(restored.accounts.find((item) => item.id === accountId)).toMatchObject({ archivedAt: null, version: archived.version + 1 })
  })
})
