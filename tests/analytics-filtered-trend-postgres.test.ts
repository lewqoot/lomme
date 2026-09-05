import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'
import { buildFilteredTrend, buildSlices, sliceKey } from '../src/features/analytics/model.js'

type StoreClient = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>; release(): void }
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('категорийный тренд PostgreSQL store', () => {
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

  it('возвращает полные bucket/category агрегаты и фильтрует их до итога', async () => {
    const session = await store.createSession({ id: 7401, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const initial = await store.snapshot(session.user.id)
    const accountId = initial.accounts[0]!.id
    const [food, transport] = initial.categories.filter((item) => item.type === 'expense')
    for (const [index, category] of [food!, transport!].entries()) await store.createTransaction(session.user.id, {
      workspaceId: initial.activeWorkspaceId,
      type: 'expense',
      amountKopecks: (index + 1) * 10_000,
      accountId,
      targetAccountId: null,
      categoryId: category.id,
      occurredAt: '2026-09-10T12:00:00.000Z',
      note: '',
      source: 'manual',
    }, `trend-postgres-${index}`)

    const summary = (await store.snapshot(session.user.id, initial.activeWorkspaceId, { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z' }, null)).summary
    expect(summary.trendByCategory).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-10', categoryId: food!.id, amountKopecks: 10_000, type: 'expense' }),
      expect.objectContaining({ date: '2026-09-10', categoryId: transport!.id, amountKopecks: 20_000, type: 'expense' }),
    ]))
    const excluded = new Set([sliceKey('expense', food!.id)])
    const trend = buildFilteredTrend(summary, 'expense', excluded)
    const total = buildSlices(summary, 'expense', excluded).totalKopecks
    expect(trend.reduce((sum, point) => sum + point.expenseKopecks, 0)).toBe(total)
    expect(total).toBe(20_000)
  })
})
