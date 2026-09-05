import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { createTelegramInitDataForTest, type TelegramIdentity } from '../server/auth/telegram.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('публичные пользовательские сценарии', () => {
  let store: MemoryFinanceStore
  let app: Awaited<ReturnType<typeof buildApp>>
  const token = 'public-flows-test-token'

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DEV_AUTH = 'false'
    process.env.TELEGRAM_BOT_TOKEN = token
    process.env.TELEGRAM_BOT_USERNAME = 'lomme_test_bot'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
  })
  afterEach(async () => { await app.close() })

  async function session(identity: TelegramIdentity) {
    const result = await store.createSession(identity, 'Europe/Moscow')
    return { ...result, cookie: `lomme_session=${result.token}` }
  }

  it('экспортирует только кошельки, к которым у пользователя есть доступ', async () => {
    const alex = await session({ id: 7001, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' })
    const irina = await session({ id: 7002, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' })
    const alexExport = await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { cookie: alex.cookie } })
    const irinaExport = await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { cookie: irina.cookie } })

    expect(alexExport.statusCode).toBe(200)
    expect(alexExport.headers['cache-control']).toBe('no-store')
    expect(alexExport.json().accounts).toHaveLength(1)
    expect(irinaExport.json().accounts).toHaveLength(1)
    expect(alexExport.json().accounts[0].id).not.toBe(irinaExport.json().accounts[0].id)
    expect(alexExport.json().transactions.length).toBeGreaterThan(0)
    expect((await app.inject({ method: 'GET', url: '/api/v1/me/export' })).statusCode).toBe(401)
  })

  it('удаляет профиль только с явным подтверждением и отзывает все сессии', async () => {
    const alex = await session({ id: 7101, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' })
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie: alex.cookie }, payload: { confirmation: 'да' } })).statusCode).toBe(400)

    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie: alex.cookie }, payload: { confirmation: 'УДАЛИТЬ' } })
    expect(removed.statusCode).toBe(204)
    expect(removed.headers['set-cookie']).toContain('lomme_session=;')
    expect((await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { cookie: alex.cookie } })).statusCode).toBe(401)
  })

  it('не оставляет общий кошелёк без владельца', async () => {
    const owner = await session({ id: 7201, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' })
    const guest = await session({ id: 7202, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru' })
    const snapshot = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const invite = await store.createAccountInvite(owner.user.id, snapshot.activeAccountId)
    await store.acceptAccountInvite(guest.user.id, invite.token)

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie: owner.cookie }, payload: { confirmation: 'УДАЛИТЬ' } })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PROFILE_OWNS_SHARED_ACCOUNT')
  })

  it('старый initData работает только с живой сессией того же пользователя', async () => {
    const identity: TelegramIdentity = { id: 7301, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }
    const current = await session(identity)
    const staleInitData = createTelegramInitDataForTest(identity, token, new Date(Date.now() - 6 * 60 * 1_000))

    const withoutSession = await app.inject({
      method: 'POST', url: '/api/v1/auth/telegram',
      payload: { initData: staleInitData, timezone: 'Europe/Moscow' },
    })
    expect(withoutSession.statusCode).toBe(401)
    expect(withoutSession.json().error.code).toBe('TELEGRAM_AUTH_EXPIRED')

    const reusedWebView = await app.inject({
      method: 'POST', url: '/api/v1/auth/telegram', headers: { cookie: current.cookie },
      payload: { initData: staleInitData, timezone: 'Europe/Moscow' },
    })
    expect(reusedWebView.statusCode).toBe(200)
    expect(reusedWebView.json().user.id).toBe(current.user.id)
  })
})
