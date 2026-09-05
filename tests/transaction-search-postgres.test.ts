import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type StoreClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  release(): void
}
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('поиск операций в PostgreSQL store', () => {
  let database: PGlite
  let store: PostgresFinanceStore

  beforeEach(async () => {
    database = new PGlite()
    await database.waitReady
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> }
    for (const migration of journal.entries) await database.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), 'utf8'))
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

  afterEach(async () => store.close())

  it('ищет дальше первой страницы с SQL-пагинацией и проверяет права', async () => {
    const owner = await store.createSession({ id: 7301, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const outsider = await store.createSession({ id: 7302, firstName: 'Ирина', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const initial = await store.snapshot(owner.user.id)
    const accountId = initial.accounts[0]!.id
    const categoryId = initial.categories.find((item) => item.type === 'expense')!.id
    let hiddenId = ''
    for (let index = 0; index < 25; index += 1) {
      const created = await store.createTransaction(owner.user.id, {
        workspaceId: initial.activeWorkspaceId,
        type: 'expense',
        amountKopecks: index === 24 ? 47_080_50 : 100 + index,
        accountId,
        targetAccountId: null,
        categoryId,
        occurredAt: new Date(Date.UTC(2026, 8, 25, 12, 0, 0) - index * 60_000).toISOString(),
        note: index === 24 ? 'Редкий маяк' : `Обычная покупка ${index}`,
        source: 'manual',
      }, `postgres-search-${index}`)
      if (index === 24) hiddenId = created.id
    }
    const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z' }
    const firstJournal = await store.snapshot(owner.user.id, initial.activeWorkspaceId, range, null)
    expect(firstJournal.transactions.some((item) => item.id === hiddenId)).toBe(false)

    const byNote = await store.searchTransactions(owner.user.id, initial.activeWorkspaceId, range, 'редкий маяк')
    expect(byNote.items.map((item) => item.id)).toEqual([hiddenId])
    const byAmount = await store.searchTransactions(owner.user.id, initial.activeWorkspaceId, range, '47 080,5')
    expect(byAmount.items.map((item) => item.id)).toEqual([hiddenId])

    const first = await store.searchTransactions(owner.user.id, initial.activeWorkspaceId, range, 'покупка', undefined, 10)
    expect(first.items).toHaveLength(10)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await store.searchTransactions(owner.user.id, initial.activeWorkspaceId, range, 'покупка', first.nextCursor!, 10)
    expect(second.items).toHaveLength(10)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(20)

    const outsiderSnapshot = await store.snapshot(outsider.user.id)
    await expect(store.searchTransactions(owner.user.id, outsiderSnapshot.activeWorkspaceId, range, 'маяк')).rejects.toMatchObject({ statusCode: 403 })
  })
})
