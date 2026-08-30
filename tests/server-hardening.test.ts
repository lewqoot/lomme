import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { createTelegramInitDataForTest, type TelegramIdentity } from '../server/auth/telegram.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

const originalNodeEnv = process.env.NODE_ENV
const originalDevAuth = process.env.ALLOW_DEV_AUTH
const originalBotToken = process.env.TELEGRAM_BOT_TOKEN

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv
  if (originalDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH; else process.env.ALLOW_DEV_AUTH = originalDevAuth
  if (originalBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = originalBotToken
})

describe('защита сервера', () => {
  it('не запускается с dev-auth в production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_DEV_AUTH = 'true'
    await expect(buildApp(new MemoryFinanceStore())).rejects.toThrow('ALLOW_DEV_AUTH must be disabled in production')
  })

  it('считает лимит по пользователю и возвращает настоящий 429', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DEV_AUTH = 'false'
    process.env.TELEGRAM_BOT_TOKEN = 'rate-limit-test-token'
    const app = await buildApp(new MemoryFinanceStore())
    const cookieFor = async (identity: TelegramIdentity) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: createTelegramInitDataForTest(identity, process.env.TELEGRAM_BOT_TOKEN!), timezone: 'Europe/Moscow' },
      })
      const raw = response.headers['set-cookie']!
      return (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
    }
    const first = await cookieFor({ id: 101, firstName: 'Первый', lastName: null, username: null, languageCode: 'ru' })
    const second = await cookieFor({ id: 202, firstName: 'Второй', lastName: null, username: null, languageCode: 'ru' })

    for (let index = 0; index < 10; index += 1) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie: first }, payload: { replace: true } })).statusCode).toBe(201)
      expect((await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie: second }, payload: { replace: true } })).statusCode).toBe(201)
    }
    const limited = await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie: first }, payload: { replace: true } })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('RATE_LIMITED')
    expect(limited.headers['retry-after']).toBeDefined()
    await app.close()
  })

  it('не проверяет сессию ради статического файла', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DEV_AUTH = 'true'
    const store = new MemoryFinanceStore()
    const sessionLookup = vi.spyOn(store, 'userForSession')
    const app = await buildApp(store)
    const auth = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: '', timezone: 'Europe/Moscow' },
    })
    const raw = auth.headers['set-cookie']!
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
    sessionLookup.mockClear()

    const response = await app.inject({ method: 'GET', url: '/favicon.svg', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(sessionLookup).not.toHaveBeenCalled()
    await app.close()
  })

  it('возвращает клиенту подписанный Telegram start_param', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DEV_AUTH = 'false'
    process.env.TELEGRAM_BOT_TOKEN = 'start-param-test-token'
    const app = await buildApp(new MemoryFinanceStore())
    const identity: TelegramIdentity = { id: 303, firstName: 'Гость', lastName: null, username: null, languageCode: 'ru' }
    const startParam = `invite_${'b'.repeat(32)}`
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: createTelegramInitDataForTest(identity, process.env.TELEGRAM_BOT_TOKEN, new Date(), undefined, startParam), timezone: 'Europe/Moscow' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ startParam })
    await app.close()
  })
})
