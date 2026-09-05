import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { createTelegramInitDataForTest, type TelegramIdentity } from '../server/auth/telegram.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

/**
 * Записи переноса датированы августом, а снапшот по умолчанию отдаёт текущий
 * месяц — поэтому тест обязан задавать «сейчас» сам. Без этого он проходил
 * весь август и начал падать первого сентября, ничего не сообщая о коде.
 */
const NOW = new Date('2026-08-28T12:00:00.000Z')

describe('перенос локального design-preview в аккаунт Telegram', () => {
  const token = 'migration-test-token'
  const identity: TelegramIdentity = { id: 442_771, firstName: 'Тест', lastName: null, username: 'migration_test', languageCode: 'ru' }
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    process.env.TELEGRAM_BOT_TOKEN = token
    process.env.APP_URL = 'https://lomme-production.up.railway.app'
    process.env.LEGACY_PREVIEW_URL = 'https://design-preview-production.up.railway.app'
    process.env.ALLOW_DEV_AUTH = 'false'
    app = await buildApp(new MemoryFinanceStore())
  })
  afterEach(async () => { await app.close(); vi.useRealTimers() })

  const initData = () => createTelegramInitDataForTest(identity, token)
  const payload = () => ({
    initData: initData(),
    timezone: 'Europe/Moscow',
    categories: [{ id: 'legacy-coffee', type: 'expense' as const, name: 'Кофе', icon: 'coffee', color: '#EA082E' }],
    entries: [
      { id: 'legacy-1', type: 'expense' as const, amountKopecks: 320_00, categoryId: 'legacy-coffee', occurredAt: '2026-08-28T08:30:00.000Z', note: 'Латте' },
      { id: 'legacy-2', type: 'income' as const, amountKopecks: 1_500_00, categoryId: null, occurredAt: '2026-08-28T09:30:00.000Z', note: 'Возврат' },
    ],
    openingBalanceKopecks: 500_00,
  })

  async function snapshot() {
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: initData(), timezone: 'Europe/Moscow' } })
    const raw = auth.headers['set-cookie']!
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
    return (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
  }

  it('переносит записи в тот же аккаунт, сохраняет категорию и не плодит дубли', async () => {
    const baseline = await snapshot()
    const balanceBefore = baseline.accounts[0].balanceKopecks
    const first = await app.inject({
      method: 'POST', url: '/api/v1/migrations/design-preview',
      headers: { origin: 'https://design-preview-production.up.railway.app' }, payload: payload(),
    })
    expect(first.statusCode).toBe(200)
    expect(first.headers['access-control-allow-origin']).toBe('https://design-preview-production.up.railway.app')
    expect(first.json()).toMatchObject({ accepted: 2, target: 'https://lomme-production.up.railway.app' })

    const once = await snapshot()
    expect(once.accounts[0].balanceKopecks - balanceBefore).toBe(168_000)
    const coffee = once.categories.find((category: { name: string }) => category.name === 'Кофе')
    expect(once.transactions.find((entry: { note: string }) => entry.note === 'Латте')).toMatchObject({ categoryId: coffee.id, source: 'import' })
    expect(once.transactions.find((entry: { note: string }) => entry.note === 'Возврат')).toMatchObject({ source: 'import' })
    expect((await app.inject({ method: 'POST', url: '/api/v1/migrations/design-preview', payload: payload() })).statusCode).toBe(200)
    const twice = await snapshot()
    expect(twice.accounts[0].balanceKopecks - balanceBefore).toBe(168_000)
    expect(twice.transactions.filter((entry: { note: string }) => entry.note === 'Латте')).toHaveLength(1)
    expect(twice.transactions.filter((entry: { note: string }) => entry.note === 'Возврат')).toHaveLength(1)
  })

  it('не принимает перенос без подписанных данных Telegram', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/migrations/design-preview', payload: { ...payload(), initData: '' } })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('TELEGRAM_AUTH_MISSING')
  })

  it('принимает подписанные данные из переоткрытого iOS WebView', async () => {
    const openedSevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/migrations/design-preview',
      payload: { ...payload(), initData: createTelegramInitDataForTest(identity, token, openedSevenDaysAgo) },
    })
    expect(response.statusCode).toBe(200)
  })
})
