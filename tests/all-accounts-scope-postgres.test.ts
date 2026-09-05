import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PostgresFinanceStore } from '../server/store/postgres.js'

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number }
type StoreClient = { query(sql: string, params?: unknown[]): Promise<QueryResult>; release(): void }
type StorePool = Pick<StoreClient, 'query'> & { connect(): Promise<StoreClient>; end(): Promise<void> }

describe('область «Все счета» PostgreSQL store', () => {
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

  it('считает видимый входящий перевод один раз и не превращает его в доход', async () => {
    const session = await store.createSession({ id: 7701, firstName: 'Алекс', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const initial = await store.snapshot(session.user.id)
    const sourceId = initial.accounts[0]!.id
    const target = await store.createAccount(session.user.id, {
      workspaceId: initial.activeWorkspaceId,
      name: 'Накопления',
      kind: 'savings',
      icon: 'wallet',
      color: '#13C97A',
      openingBalanceKopecks: 0,
    })
    const transfer = await store.createTransaction(session.user.id, {
      workspaceId: initial.activeWorkspaceId,
      type: 'transfer',
      amountKopecks: 25_000,
      accountId: sourceId,
      targetAccountId: target.id,
      categoryId: null,
      occurredAt: '2026-09-05T12:00:00.000Z',
      note: 'В накопления',
      source: 'manual',
    }, 'all-accounts-transfer')
    const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }

    const recipient = await store.snapshot(session.user.id, initial.activeWorkspaceId, range, target.id)
    expect(recipient.transactions.map((item) => item.id)).toContain(transfer.id)
    expect(recipient.summary).toMatchObject({ operationCount: 1, incomeKopecks: 0, expenseKopecks: 0 })

    const aggregate = await store.snapshot(session.user.id, initial.activeWorkspaceId, range, null)
    expect(aggregate.activeAccountId).toBeNull()
    expect(aggregate.transactions.filter((item) => item.id === transfer.id)).toHaveLength(1)
    expect(aggregate.summary).toMatchObject({ operationCount: 1, incomeKopecks: 0, expenseKopecks: 0 })
  })

  it('ограничивает aggregate явно выбранным пространством', async () => {
    const owner = await store.createSession({ id: 7702, firstName: 'Владелец', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const guest = await store.createSession({ id: 7703, firstName: 'Гость', lastName: null, username: null, languageCode: 'ru' }, 'Europe/Moscow')
    const ownerSnapshot = await store.snapshot(owner.user.id)
    const guestSnapshot = await store.snapshot(guest.user.id)
    const invite = await store.createAccountInvite(owner.user.id, ownerSnapshot.accounts[0]!.id)
    await store.acceptAccountInvite(guest.user.id, invite.token)
    await store.createTransaction(owner.user.id, {
      workspaceId: ownerSnapshot.activeWorkspaceId,
      type: 'income',
      amountKopecks: 50_000,
      accountId: ownerSnapshot.accounts[0]!.id,
      targetAccountId: null,
      categoryId: null,
      occurredAt: '2026-09-05T13:00:00.000Z',
      note: '',
      source: 'manual',
    }, 'shared-workspace-income')
    await store.createTransaction(guest.user.id, {
      workspaceId: guestSnapshot.activeWorkspaceId,
      type: 'expense',
      amountKopecks: 10_000,
      accountId: guestSnapshot.accounts[0]!.id,
      targetAccountId: null,
      categoryId: guestSnapshot.categories.find((category) => category.type === 'expense')!.id,
      occurredAt: '2026-09-05T14:00:00.000Z',
      note: '',
      source: 'manual',
    }, 'personal-workspace-expense')
    const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }

    const sharedAggregate = await store.snapshot(guest.user.id, ownerSnapshot.activeWorkspaceId, range, null)
    expect(sharedAggregate.workspaces).toHaveLength(2)
    expect(sharedAggregate.activeWorkspaceId).toBe(ownerSnapshot.activeWorkspaceId)
    expect(sharedAggregate.summary).toMatchObject({ operationCount: 1, incomeKopecks: 50_000, expenseKopecks: 0 })
    expect(sharedAggregate.transactions.every((item) => item.accountId === ownerSnapshot.accounts[0]!.id)).toBe(true)
  })
})
