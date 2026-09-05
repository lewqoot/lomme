import { describe, expect, it } from 'vitest'
import { bundledSchema } from '../server/lib/release.js'
import { PostgresFinanceStore } from '../server/store/postgres.js'

const describeWithPostgres = process.env.CI_POSTGRES_SMOKE === 'true' ? describe : describe.skip

describeWithPostgres('PostgreSQL migrations from scratch', () => {
  it('serves a real store after every bundled migration is applied', async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL is required for CI_POSTGRES_SMOKE')

    const store = new PostgresFinanceStore(databaseUrl)
    try {
      const session = await store.createSession({
        id: Number(`${Date.now()}`.slice(-12)),
        firstName: 'CI',
        lastName: null,
        username: 'lomme_ci',
        languageCode: 'ru',
      }, 'UTC')
      const snapshot = await store.snapshot(session.user.id)
      const readiness = await store.readiness()
      const schema = bundledSchema()

      expect(snapshot.accounts).toHaveLength(1)
      expect(snapshot.categories.length).toBeGreaterThan(0)
      expect(readiness).toMatchObject({
        ready: true,
        database: 'ok',
        migrations: { applied: schema.migrations, expected: schema.migrations },
      })
    } finally {
      await store.close()
    }
  })
})
