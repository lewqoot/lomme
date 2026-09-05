import { describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { calculateSummary } from '../src/shared/summary.js'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'

const category: CategoryView = { id: 'c1', type: 'expense', name: 'Кафе', icon: 'utensils', color: '#EA082E', order: 0, parentId: null, version: 1, archivedAt: null }
const incomeCategory: CategoryView = { id: 'salary', type: 'income', name: 'Зарплата', icon: 'banknote', color: '#07E240', order: 0, parentId: null, version: 1, archivedAt: null }
const base = { accountId: 'a1', targetAccountId: null, note: '', source: 'manual' as const, authorName: 'Алекс', version: 1 }
const expense = (id: string, at: string, amountKopecks: number): TransactionView =>
  ({ ...base, id, type: 'expense', amountKopecks, categoryId: category.id, occurredAt: at })

describe('аудит: агрегаты', () => {
  it('«самый дорогой день» остаётся днём, даже когда график считает по месяцам', () => {
    // Год: график переходит на месячные корзины, но плитка обязана назвать день.
    const transactions = [
      expense('1', '2026-03-10T09:00:00.000Z', 10_000),
      expense('2', '2026-03-11T09:00:00.000Z', 20_000),
      expense('3', '2026-03-12T09:00:00.000Z', 30_000),
    ]
    const summary = calculateSummary(transactions, [category], { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-12-31T23:59:59Z') })
    expect(summary.granularity).toBe('month')
    // Месяц суммарно 60 000, но самый дорогой ДЕНЬ — 30 000.
    expect(summary.mostExpensiveDayKopecks).toBe(30_000)
    expect(summary.mostExpensiveDay).toBe('2026-03-12')
  })

  it('средние траты в день делятся на прошедшие дни периода', () => {
    const transactions = [expense('1', '2026-08-05T09:00:00.000Z', 26_000)]
    const summary = calculateSummary(
      transactions, [category],
      { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59Z') },
      new Date('2026-08-26T12:00:00Z'),
    )
    expect(summary.elapsedDays).toBe(26)
    expect(summary.averageExpensePerDayKopecks).toBe(1_000)
    expect(summary.trend).toHaveLength(26)
    expect(summary.trend[0]).toEqual({ date: '2026-08-01', incomeKopecks: 0, expenseKopecks: 0 })
    expect(summary.trend[4]).toEqual({ date: '2026-08-05', incomeKopecks: 0, expenseKopecks: 26_000 })
  })

  it('не падает на длинном журнале при поиске максимума', () => {
    const many = Array.from({ length: 200_000 }, (_, index) => expense(String(index), '2026-08-05T09:00:00.000Z', index + 1))
    const summary = calculateSummary(many, [category], { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59Z') })
    expect(summary.largestExpenseKopecks).toBe(200_000)
  })

  it('раскладывает ночную трату по дню пользователя, а не сервера', () => {
    const summary = calculateSummary(
      [expense('night', '2026-07-31T22:30:00.000Z', 10_000)],
      [category],
      { start: new Date('2026-07-31T21:00:00.000Z'), end: new Date('2026-08-31T20:59:59.999Z') },
      new Date('2026-08-15T12:00:00.000Z'),
      'Europe/Moscow',
    )
    expect(summary.mostExpensiveDay).toBe('2026-08-01')
    expect(summary.trend[0]?.date).toBe('2026-08-01')
  })

  it('считает все плитки по полному периоду и сохраняет категории максимумов', () => {
    const transactions: TransactionView[] = [
      expense('weekend-1', '2026-08-01T09:00:00.000Z', 10_000),
      expense('weekend-2', '2026-08-02T09:00:00.000Z', 30_000),
      expense('weekday', '2026-08-03T09:00:00.000Z', 60_000),
      { ...base, id: 'salary-income', type: 'income', amountKopecks: 319_000_00, categoryId: incomeCategory.id, occurredAt: '2026-08-04T09:00:00.000Z' },
      { ...base, id: 'transfer', type: 'transfer', amountKopecks: 5_000_00, categoryId: null, targetAccountId: 'a2', occurredAt: '2026-08-05T09:00:00.000Z' },
    ]
    const summary = calculateSummary(
      transactions, [category, incomeCategory],
      { start: new Date('2026-07-31T21:00:00.000Z'), end: new Date('2026-08-31T20:59:59.999Z') },
      new Date('2026-08-10T12:00:00.000Z'),
      'Europe/Moscow',
    )

    expect(summary.largestExpenseCategoryId).toBe(category.id)
    expect(summary.largestIncomeCategoryId).toBe(incomeCategory.id)
    expect(summary.weekendExpenseSharePercent).toBe(40)
    expect(summary.expenseFreeStreakDays).toBe(7)
    expect(summary.operationCount).toBe(5)
    expect(summary.mostFrequentExpenseCategoryId).toBe(category.id)
    expect(summary.mostFrequentExpenseCategoryCount).toBe(3)
  })
})

describe('аудит: снимок ограничен периодом', () => {
  it('не отдаёт операции вне выбранного окна', async () => {
    process.env.ALLOW_DEV_AUTH = 'true'
    const app = await buildApp(new MemoryFinanceStore())
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
    const raw = auth.headers['set-cookie']!
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]

    const first = await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })
    const data = first.json()
    const account = data.accounts[0]
    const expenseCategory = data.categories.find((item: { type: string }) => item.type === 'expense')

    const now = new Date()
    const old = new Date(now.getFullYear(), now.getMonth() - 6, 15, 12)
    await app.inject({
      method: 'POST', url: '/api/v1/transactions',
      headers: { cookie, 'idempotency-key': 'audit-old' },
      payload: { workspaceId: data.activeWorkspaceId, type: 'expense', amountKopecks: 99_000, accountId: account.id, categoryId: expenseCategory.id, occurredAt: old.toISOString(), note: '', source: 'manual' },
    })

    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const scoped = await app.inject({ method: 'GET', url: `/api/v1/snapshot?start=${start.toISOString()}&end=${end.toISOString()}`, headers: { cookie } })
    const snapshot = scoped.json()

    const outside = snapshot.transactions.filter((item: { occurredAt: string }) => new Date(item.occurredAt) < start)
    expect(outside).toHaveLength(0)
    // Баланс счёта по-прежнему считается по всему журналу, а не по окну.
    const ledgerTotal = snapshot.accounts.reduce((sum: number, item: { balanceKopecks: number }) => sum + item.balanceKopecks, 0)
    expect(ledgerTotal).not.toBe(snapshot.summary.netKopecks)
    await app.close()
  })

  it('агрегаты считают операции за пределами первой страницы журнала', async () => {
    process.env.ALLOW_DEV_AUTH = 'true'
    const app = await buildApp(new MemoryFinanceStore())
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
    const raw = auth.headers['set-cookie']!
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
    const initial = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    const account = initial.accounts[0]
    const expenseCategory = initial.categories.find((item: { type: string }) => item.type === 'expense')

    for (let index = 0; index < 12; index += 1) {
      await app.inject({
        method: 'POST', url: '/api/v1/transactions',
        headers: { cookie, 'idempotency-key': `audit-page-${index}` },
        payload: { workspaceId: initial.activeWorkspaceId, type: 'expense', amountKopecks: 100 + index, accountId: account.id, categoryId: expenseCategory.id, occurredAt: new Date().toISOString(), note: '', source: 'manual' },
      })
    }

    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
    expect(snapshot.transactions).toHaveLength(20)
    expect(snapshot.transactionsNextCursor).toEqual(expect.any(String))
    expect(snapshot.summary.operationCount).toBe(initial.summary.operationCount + 12)
    expect(snapshot.summary.mostFrequentExpenseCategoryCount).toBeGreaterThanOrEqual(12)
    await app.close()
  })
})
