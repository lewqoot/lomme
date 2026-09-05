import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type StoreClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  release(): void
}
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('экспорт и удаление профиля в PostgreSQL store', () => {
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

  it('применяет ACL экспорта и не удаляет владельца общего кошелька', async () => {
    const owner = await store.createSession({ id: 8101, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    const guest = await store.createSession({ id: 8102, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' }, 'Europe/Moscow')
    const ownerSnapshot = await store.snapshot(owner.user.id)
    const ownerAccountId = ownerSnapshot.activeAccountId!
    await store.createTransaction(owner.user.id, {
      workspaceId: ownerSnapshot.activeWorkspaceId,
      type: 'expense',
      amountKopecks: 1_250_00,
      accountId: ownerAccountId,
      targetAccountId: null,
      categoryId: ownerSnapshot.categories.find((category) => category.type === 'expense')!.id,
      occurredAt: '2026-09-05T12:00:00.000Z',
      note: 'Проверка экспорта',
      source: 'manual',
    }, 'public-export-postgres')
    const guestBefore = await store.exportUserData(guest.user.id)
    expect(guestBefore.accounts.some((account) => account.id === ownerAccountId)).toBe(false)

    const invite = await store.createAccountInvite(owner.user.id, ownerAccountId)
    await store.acceptAccountInvite(guest.user.id, invite.token)
    const guestAfter = await store.exportUserData(guest.user.id)
    expect(guestAfter.accounts.find((account) => account.id === ownerAccountId)).toMatchObject({ accessRole: 'editor' })
    expect(guestAfter.transactions.length).toBeGreaterThan(0)

    await expect(store.deleteProfile(owner.user.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROFILE_OWNS_SHARED_ACCOUNT',
    })
    await store.removeAccountMember(owner.user.id, ownerAccountId, guest.user.id)
    await store.deleteProfile(owner.user.id)
    await expect(store.exportUserData(owner.user.id)).rejects.toMatchObject({ statusCode: 403 })
    expect(await store.userForSession(owner.token)).toBeNull()
  })
})
