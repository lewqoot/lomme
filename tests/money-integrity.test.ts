import { describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { initialCalc, pressKey, resolveKopecks, type CalcKey } from '../src/features/editor/calculator.js'

/** A live app plus a session, so every case runs through the real API. */
async function session() {
  process.env.ALLOW_DEV_AUTH = 'true'
  const app = await buildApp(new MemoryFinanceStore())
  const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
  const raw = auth.headers['set-cookie']!
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
  const snapshot = async (query = '') => (await app.inject({ method: 'GET', url: `/api/v1/snapshot${query}`, headers: { cookie } })).json()
  const first = await snapshot()
  const add = (payload: Record<string, unknown>, key: string = crypto.randomUUID()) =>
    app.inject({ method: 'POST', url: '/api/v1/transactions', headers: { cookie, 'idempotency-key': key }, payload: { workspaceId: first.activeWorkspaceId, source: 'manual', note: '', ...payload } })
  return { app, cookie, snapshot, add, data: first }
}

const balances = (snapshot: { accounts: Array<{ balanceKopecks: number }> }) =>
  snapshot.accounts.reduce((sum, item) => sum + item.balanceKopecks, 0)

describe('целостность денег', () => {
  it('копейки не теряются на сотне мелких трат', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const before = balances(await snapshot())

    // 100 операций по 33 копейки: если где-то счёт идёт через float, сумма поедет.
    for (let index = 0; index < 100; index += 1) {
      await add({ type: 'expense', amountKopecks: 33, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    }
    const after = await snapshot()
    expect(before - balances(after)).toBe(3_300)
    await app.close()
  })

  it('перевод между счетами не меняет общий остаток', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const source = data.accounts[0]
    const created = await app.inject({ method: 'POST', url: '/api/v1/accounts', headers: { cookie }, payload: { workspaceId: data.activeWorkspaceId, name: 'Копилка', kind: 'cash', openingBalanceKopecks: 0 } })
    expect(created.statusCode).toBeLessThan(300)
    const target = (await snapshot()).accounts.find((item: { name: string }) => item.name === 'Копилка')

    const start = await snapshot()
    const before = balances(start)
    await add({ type: 'transfer', amountKopecks: 250_00, accountId: source.id, targetAccountId: target.id, categoryId: null, occurredAt: new Date().toISOString() })
    const after = await snapshot()

    expect(balances(after)).toBe(before)
    expect(after.accounts.find((item: { id: string }) => item.id === target.id).balanceKopecks).toBe(250_00)
    // Перевод не доход и не расход периода: сводка не должна шелохнуться.
    expect(after.summary.incomeKopecks).toBe(start.summary.incomeKopecks)
    expect(after.summary.expenseKopecks).toBe(start.summary.expenseKopecks)
    await app.close()
  })

  it('правка суммы заменяет старую, а не добавляет вторую', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const before = balances(await snapshot())

    const created = await add({ type: 'expense', amountKopecks: 100_00, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    const { id } = created.json()
    const stored = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)

    await app.inject({
      method: 'PUT', url: `/api/v1/transactions/${id}`, headers: { cookie },
      payload: { type: 'expense', amountKopecks: 40_00, accountId: account.id, targetAccountId: null, categoryId: category.id, occurredAt: stored.occurredAt, note: '', version: stored.version },
    })
    const after = await snapshot()
    expect(before - balances(after)).toBe(40_00)
    await app.close()
  })

  it('удаление возвращает остаток ровно к прежнему', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const before = balances(await snapshot())

    const created = await add({ type: 'expense', amountKopecks: 1_234_56, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    const { id } = created.json()
    const stored = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)
    await app.inject({ method: 'DELETE', url: `/api/v1/transactions/${id}?version=${stored.version}`, headers: { cookie } })

    expect(balances(await snapshot())).toBe(before)
    await app.close()
  })

  it('удаляет сразу, а отмену подтверждает отдельным восстановлением', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const before = balances(await snapshot())
    const { id } = (await add({
      type: 'expense', amountKopecks: 321_00, accountId: account.id, categoryId: category.id,
      occurredAt: new Date().toISOString(),
    })).json()
    const created = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/transactions/${id}?version=${created.version}`, headers: { cookie } })
    expect(removed.statusCode).toBe(204)
    expect((await snapshot()).transactions.some((item: { id: string }) => item.id === id)).toBe(false)
    expect(balances(await snapshot())).toBe(before)

    const restored = await app.inject({
      method: 'POST', url: `/api/v1/transactions/${id}/restore`, headers: { cookie }, payload: { version: created.version + 1 },
    })
    expect(restored.statusCode).toBe(204)
    const afterUndo = await snapshot()
    expect(afterUndo.transactions.find((item: { id: string }) => item.id === id)).toMatchObject({ version: created.version + 2 })
    expect(before - balances(afterUndo)).toBe(321_00)

    const staleUndo = await app.inject({
      method: 'POST', url: `/api/v1/transactions/${id}/restore`, headers: { cookie }, payload: { version: created.version + 1 },
    })
    expect(staleUndo.statusCode).toBe(409)
    expect((await snapshot()).transactions.filter((item: { id: string }) => item.id === id)).toHaveLength(1)
    await app.close()
  })

  it('сумма по категориям сходится с итогом периода', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const expense = data.categories.filter((item: { type: string }) => item.type === 'expense').slice(0, 3)
    for (const [index, category] of expense.entries()) {
      await add({ type: 'expense', amountKopecks: 111_11 * (index + 1), accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    }
    const { summary } = await snapshot()
    const fromCategories = summary.byCategory
      .filter((item: { type: string }) => item.type === 'expense')
      .reduce((sum: number, item: { amountKopecks: number }) => sum + item.amountKopecks, 0)
    expect(fromCategories).toBe(summary.expenseKopecks)
    expect(summary.netKopecks).toBe(summary.incomeKopecks - summary.expenseKopecks)
    await app.close()
  })

  it('повтор запроса с тем же ключом не удваивает операцию', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    const before = balances(await snapshot())
    const payload = { type: 'expense', amountKopecks: 500_00, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() }
    await add(payload, 'same-key')
    await add(payload, 'same-key')
    expect(before - balances(await snapshot())).toBe(500_00)
    await app.close()
  })

  it('сервер не принимает дробные и отрицательные суммы', async () => {
    const { app, add, data } = await session()
    const account = data.accounts[0]
    const category = data.categories.find((item: { type: string }) => item.type === 'expense')
    for (const amountKopecks of [12.5, -100, 0]) {
      const response = await add({ type: 'expense', amountKopecks, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    }
    await app.close()
  })
})

/**
 * The expense path above is the one that grew test-first; income reached the same
 * store through the same calls but was never asserted on. These mirror the expense
 * cases sign for sign, so a change that quietly treats income as an expense - or
 * drops it from a total - fails here rather than on someone's real ledger.
 */
describe('целостность денег: доход', () => {
  const incomeCategory = (data: { categories: Array<{ type: string; id: string }> }) =>
    data.categories.find((item) => item.type === 'income')!

  it('копейки не теряются на сотне мелких доходов', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = incomeCategory(data)
    const before = balances(await snapshot())

    for (let index = 0; index < 100; index += 1) {
      await add({ type: 'income', amountKopecks: 33, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    }
    expect(balances(await snapshot()) - before).toBe(3_300)
    await app.close()
  })

  it('доход поднимает остаток ровно на сумму, а не опускает', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const before = balances(await snapshot())
    await add({ type: 'income', amountKopecks: 1_234_56, accountId: account.id, categoryId: incomeCategory(data).id, occurredAt: new Date().toISOString() })
    expect(balances(await snapshot()) - before).toBe(1_234_56)
    await app.close()
  })

  it('доход без категории тоже попадает в сводку', async () => {
    const { app, snapshot, add, data } = await session()
    const start = await snapshot()
    await add({ type: 'income', amountKopecks: 500_00, accountId: data.accounts[0].id, categoryId: null, occurredAt: new Date().toISOString() })
    const after = await snapshot()
    expect(after.summary.incomeKopecks - start.summary.incomeKopecks).toBe(500_00)
    expect(after.summary.expenseKopecks).toBe(start.summary.expenseKopecks)
    await app.close()
  })

  it('сумма доходов по категориям сходится с итогом периода', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const categories = data.categories.filter((item: { type: string }) => item.type === 'income').slice(0, 2)
    for (const [index, category] of categories.entries()) {
      await add({ type: 'income', amountKopecks: 111_11 * (index + 1), accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })
    }
    const { summary } = await snapshot()
    const fromCategories = summary.byCategory
      .filter((item: { type: string }) => item.type === 'income')
      .reduce((sum: number, item: { amountKopecks: number }) => sum + item.amountKopecks, 0)
    expect(fromCategories).toBe(summary.incomeKopecks)
    await app.close()
  })

  it('доход и расход в одном периоде дают верный нетто', async () => {
    const { app, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const now = new Date().toISOString()
    const before = balances(await snapshot())
    await add({ type: 'income', amountKopecks: 1_000_00, accountId: account.id, categoryId: incomeCategory(data).id, occurredAt: now })
    await add({ type: 'expense', amountKopecks: 250_50, accountId: account.id, categoryId: data.categories.find((item: { type: string }) => item.type === 'expense').id, occurredAt: now })

    const { summary } = await snapshot()
    expect(summary.netKopecks).toBe(summary.incomeKopecks - summary.expenseKopecks)
    expect(balances(await snapshot()) - before).toBe(1_000_00 - 250_50)
    await app.close()
  })

  it('правка суммы дохода заменяет старую, а не добавляет вторую', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const category = incomeCategory(data)
    const before = balances(await snapshot())

    const { id } = (await add({ type: 'income', amountKopecks: 100_00, accountId: account.id, categoryId: category.id, occurredAt: new Date().toISOString() })).json()
    const stored = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)
    await app.inject({
      method: 'PUT', url: `/api/v1/transactions/${id}`, headers: { cookie },
      payload: { type: 'income', amountKopecks: 40_00, accountId: account.id, targetAccountId: null, categoryId: category.id, occurredAt: stored.occurredAt, note: '', version: stored.version },
    })
    expect(balances(await snapshot()) - before).toBe(40_00)
    await app.close()
  })

  it('удаление дохода возвращает остаток ровно к прежнему', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const before = balances(await snapshot())
    const { id } = (await add({ type: 'income', amountKopecks: 987_65, accountId: data.accounts[0].id, categoryId: incomeCategory(data).id, occurredAt: new Date().toISOString() })).json()
    const stored = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)
    await app.inject({ method: 'DELETE', url: `/api/v1/transactions/${id}?version=${stored.version}`, headers: { cookie } })
    expect(balances(await snapshot())).toBe(before)
    await app.close()
  })

  it('смена типа с дохода на расход разворачивает остаток целиком', async () => {
    const { app, cookie, snapshot, add, data } = await session()
    const account = data.accounts[0]
    const before = balances(await snapshot())
    const { id } = (await add({ type: 'income', amountKopecks: 300_00, accountId: account.id, categoryId: null, occurredAt: new Date().toISOString() })).json()
    const stored = (await snapshot()).transactions.find((item: { id: string }) => item.id === id)
    await app.inject({
      method: 'PUT', url: `/api/v1/transactions/${id}`, headers: { cookie },
      payload: { type: 'expense', amountKopecks: 300_00, accountId: account.id, targetAccountId: null, categoryId: null, occurredAt: stored.occurredAt, note: '', version: stored.version },
    })
    // +300 must become -300, a 600 swing, not a silent no-op.
    expect(balances(await snapshot()) - before).toBe(-300_00)
    await app.close()
  })

  it('сервер не принимает дробные и отрицательные доходы', async () => {
    const { app, add, data } = await session()
    const category = incomeCategory(data)
    for (const amountKopecks of [12.5, -100, 0]) {
      const response = await add({ type: 'income', amountKopecks, accountId: data.accounts[0].id, categoryId: category.id, occurredAt: new Date().toISOString() })
      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    }
    await app.close()
  })
})

describe('ввод сумм', () => {
  const type = (keys: string) => [...keys].reduce((state, key) => pressKey(state, key as CalcKey), initialCalc())

  it('копейки набираются точно', () => {
    expect(resolveKopecks(type('12,34'))).toBe(1_234)
    expect(resolveKopecks(type('0,05'))).toBe(5)
    expect(resolveKopecks(type('1000'))).toBe(100_000)
  })

  it('третий знак после запятой игнорируется, а не округляет вверх', () => {
    expect(resolveKopecks(type('9,999'))).toBe(999)
  })
})
