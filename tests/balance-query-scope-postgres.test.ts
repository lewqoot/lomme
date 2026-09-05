import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number }
type StoreClient = { query(sql: string, params?: unknown[]): Promise<QueryResult>; release(): void }
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('область балансного запроса PostgreSQL store', () => {
  let database: PGlite
  let store: PostgresFinanceStore
  let balanceQuery: { sql: string; params: unknown[] } | null

  beforeEach(async () => {
    database = new PGlite()
    await database.waitReady
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> }
    for (const migration of journal.entries) await database.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), 'utf8'))
    balanceQuery = null
    const query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('WITH accessible_accounts AS MATERIALIZED')) balanceQuery = { sql, params }
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

  it('не пересчитывает 100 тысяч операций постороннего кошелька', async () => {
    const owner = await store.createSession({ id: 7501, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const outsider = await store.createSession({ id: 7502, firstName: 'Ирина', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const ownerSnapshot = await store.snapshot(owner.user.id)
    const outsiderSnapshot = await store.snapshot(outsider.user.id)
    const ownerAccountId = ownerSnapshot.accounts[0]!.id
    const outsiderAccountId = outsiderSnapshot.accounts[0]!.id
    await store.createTransaction(owner.user.id, {
      workspaceId: ownerSnapshot.activeWorkspaceId,
      type: 'income',
      amountKopecks: 12_345,
      accountId: ownerAccountId,
      targetAccountId: null,
      categoryId: null,
      occurredAt: '2026-09-05T12:00:00.000Z',
      note: '',
      source: 'manual',
    }, 'balance-scope-owner')
    await database.query(`INSERT INTO transactions
      (workspace_id,type,amount_kopecks,account_id,target_account_id,category_id,occurred_at,note,source,created_by_user_id,updated_by_user_id)
      SELECT $1,'expense',100,$2,NULL,NULL,now()-(item::text || ' seconds')::interval,'noise','manual',$3,$3
      FROM generate_series(1,100000) item`, [outsiderSnapshot.activeWorkspaceId, outsiderAccountId, outsider.user.id])
    await database.exec('ANALYZE transactions')

    const snapshot = await store.snapshot(owner.user.id)
    expect(snapshot.accounts.find((item) => item.id === ownerAccountId)?.balanceKopecks).toBe(12_345)
    expect(balanceQuery).not.toBeNull()
    const captured = balanceQuery as { sql: string; params: unknown[] }
    const explained = await database.query<Record<string, unknown>>(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured.sql}`, captured.params)
    const plan = JSON.stringify(explained.rows)
    expect(plan).toContain('transactions_account_idx')
    expect(plan).toContain('transactions_target_account_idx')
    expect(plan).not.toMatch(/"Relation Name":"transactions","Alias":"t","Actual Rows":100000/)

    const timings: number[] = []
    for (let run = 0; run < 20; run += 1) {
      const started = performance.now()
      await store.snapshot(owner.user.id)
      timings.push(performance.now() - started)
    }
    timings.sort((left, right) => left - right)
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1]!
    console.info(`[LOM-11 local PGlite] snapshot p95=${p95.toFixed(2)}ms with 100000 unrelated transactions`)
    expect(p95).toBeLessThan(500)
  }, 20_000)
})
