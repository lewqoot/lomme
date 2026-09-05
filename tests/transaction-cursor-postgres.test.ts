import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number }
type StoreClient = { query(sql: string, params?: unknown[]): Promise<QueryResult>; release(): void }
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('точный cursor журнала PostgreSQL store', () => {
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

  it('не теряет строки с разными микросекундами внутри одной миллисекунды', async () => {
    const session = await store.createSession({ id: 7601, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const snapshot = await store.snapshot(session.user.id)
    const accountId = snapshot.accounts[0]!.id
    const categoryId = snapshot.categories.find((category) => category.type === 'expense')!.id
    const occurredAt = [
      '2026-09-05T12:00:00.123100Z',
      '2026-09-05T12:00:00.123200Z',
      '2026-09-05T12:00:00.123300Z',
    ]
    const createdIds: string[] = []
    for (const [index, timestamp] of occurredAt.entries()) {
      const transaction = await store.createTransaction(session.user.id, {
        workspaceId: snapshot.activeWorkspaceId,
        type: 'expense',
        amountKopecks: 100 + index,
        accountId,
        targetAccountId: null,
        categoryId,
        occurredAt: timestamp,
        note: '',
        source: 'manual',
      }, `microseconds-${index}`)
      createdIds.push(transaction.id)
    }

    const range = { start: '2026-09-05T00:00:00.000Z', end: '2026-09-06T00:00:00.000Z' }
    const first = await store.transactionsPage(session.user.id, snapshot.activeWorkspaceId, range, undefined, 2)
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await store.transactionsPage(session.user.id, snapshot.activeWorkspaceId, range, first.nextCursor!, 2)
    const returnedIds = [...first.items, ...second.items].map((item) => item.id)

    expect(returnedIds).toHaveLength(3)
    expect(new Set(returnedIds)).toEqual(new Set(createdIds))
  })

  it('использует UUID как стабильную границу при одинаковом timestamp', async () => {
    const session = await store.createSession({ id: 7602, firstName: 'Ирина', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const snapshot = await store.snapshot(session.user.id)
    const accountId = snapshot.accounts[0]!.id
    const categoryId = snapshot.categories.find((category) => category.type === 'expense')!.id
    const createdIds: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const transaction = await store.createTransaction(session.user.id, {
        workspaceId: snapshot.activeWorkspaceId,
        type: 'expense',
        amountKopecks: 200 + index,
        accountId,
        targetAccountId: null,
        categoryId,
        occurredAt: '2026-09-05T14:00:00.654321Z',
        note: '',
        source: 'manual',
      }, `same-timestamp-${index}`)
      createdIds.push(transaction.id)
    }

    const range = { start: '2026-09-05T00:00:00.000Z', end: '2026-09-06T00:00:00.000Z' }
    const returnedIds: string[] = []
    let cursor: string | undefined
    do {
      const page = await store.transactionsPage(session.user.id, snapshot.activeWorkspaceId, range, cursor, 2)
      returnedIds.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(returnedIds).toHaveLength(5)
    expect(new Set(returnedIds)).toEqual(new Set(createdIds))
  })
})
