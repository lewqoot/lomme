import { describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('установка команды на iPhone', () => {
  it('нативная ссылка отдаёт подписанную команду из текущей версии Lomme', async () => {
    const app = await buildApp(new MemoryFinanceStore())
    const response = await app.inject({ method: 'GET', url: '/shortcut/install' })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/octet-stream')
    expect(response.headers['content-disposition']).toContain('attachment')
    expect(response.headers['content-disposition']).toContain('Lomme.shortcut')
    expect(response.rawPayload.length).toBeGreaterThan(1_000)
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
