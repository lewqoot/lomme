import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { createStore, resetStoreForTest } from '../server/store/index.js'

describe('защита конфигурации', () => {
  const saved = { node: process.env.NODE_ENV, db: process.env.DATABASE_URL }

  beforeEach(() => { resetStoreForTest() })
  afterEach(() => {
    process.env.NODE_ENV = saved.node
    if (saved.db === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = saved.db
    resetStoreForTest()
  })

  it('в production без DATABASE_URL не запускается на демо-хранилище', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL

    await expect(createStore()).rejects.toThrow(/DATABASE_URL is required in production/)
  })

  it('вне production демо-хранилище по-прежнему разрешено', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.DATABASE_URL

    const store = await createStore()
    expect(await store.health()).toEqual({ database: 'memory' })
  })

  it('readyz отвечает 200, когда хранилище готово', async () => {
    process.env.NODE_ENV = 'test'
    const app = await buildApp(new MemoryFinanceStore())

    const response = await app.inject({ method: 'GET', url: '/readyz' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ready: true })
    await app.close()
  })

  it('readyz отвечает 503, когда схема отстаёт от сборки', async () => {
    process.env.NODE_ENV = 'test'
    const store = new MemoryFinanceStore()
    store.readiness = async () => ({ ready: false, database: 'ok' as const, migrations: { applied: 11, expected: 12 }, detail: 'migrations behind this build' })
    const app = await buildApp(store)

    const response = await app.inject({ method: 'GET', url: '/readyz' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ ready: false, migrations: { applied: 11, expected: 12 } })
    await app.close()
  })
})
