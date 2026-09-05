import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { PostgresFinanceStore } from '../server/store/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describePostgres = databaseUrl ? describe : describe.skip

describePostgres('PostgreSQL concurrency', () => {
  it('serializes a first Telegram login across independent connections', async () => {
    const store = new PostgresFinanceStore(databaseUrl!)
    const inspector = new pg.Pool({ connectionString: databaseUrl! })
    const telegramId = 8_000_000_000 + Math.floor(Math.random() * 100_000_000)
    try {
      const sessions = await Promise.all(Array.from({ length: 8 }, (_, index) => store.createSession({
        id: telegramId,
        firstName: `Concurrent ${index}`,
        lastName: null,
        username: `concurrent_${telegramId}`,
        languageCode: 'ru',
      }, 'Europe/Moscow')))

      expect(new Set(sessions.map((session) => session.user.id)).size).toBe(1)
      const userId = sessions[0]!.user.id
      expect(Number((await inspector.query(`SELECT count(*) FROM users WHERE telegram_user_id=$1`, [telegramId])).rows[0].count)).toBe(1)
      expect(Number((await inspector.query(`SELECT count(*) FROM workspaces WHERE owner_user_id=$1 AND kind='personal'`, [userId])).rows[0].count)).toBe(1)
      expect(Number((await inspector.query(`SELECT count(*) FROM sessions WHERE user_id=$1`, [userId])).rows[0].count)).toBe(8)
    } finally {
      await inspector.end()
      await store.close()
    }
  }, 60_000)

  it('returns one result for concurrent retries and rejects key reuse with another payload', async () => {
    const store = new PostgresFinanceStore(databaseUrl!)
    const inspector = new pg.Pool({ connectionString: databaseUrl! })
    const telegramId = 8_100_000_000 + Math.floor(Math.random() * 100_000_000)
    try {
      const session = await store.createSession({
        id: telegramId,
        firstName: 'Idempotent',
        lastName: null,
        username: `idempotent_${telegramId}`,
        languageCode: 'ru',
      }, 'Europe/Moscow')
      const snapshot = await store.snapshot(session.user.id)
      const account = snapshot.accounts[0]!
      const category = snapshot.categories.find((item) => item.type === 'expense')!
      const payload = {
        workspaceId: snapshot.activeWorkspaceId,
        type: 'expense' as const,
        amountKopecks: 12_345,
        accountId: account.id,
        targetAccountId: null,
        categoryId: category.id,
        occurredAt: new Date().toISOString(),
        note: 'Concurrent retry',
        source: 'manual' as const,
      }

      const results = await Promise.all(Array.from({ length: 8 }, () => store.createTransaction(session.user.id, payload, 'parallel-first-write')))
      expect(new Set(results.map((result) => result.id)).size).toBe(1)
      expect(Number((await inspector.query(`SELECT count(*) FROM transactions WHERE id=$1`, [results[0]!.id])).rows[0].count)).toBe(1)

      await expect(store.createTransaction(session.user.id, { ...payload, amountKopecks: payload.amountKopecks + 1 }, 'parallel-first-write'))
        .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' })
    } finally {
      await inspector.end()
      await store.close()
    }
  }, 60_000)
})
