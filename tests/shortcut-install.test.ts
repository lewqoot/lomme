import { describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('установка команды на iPhone', () => {
  it('нативная ссылка перенаправляет на подписанную команду из текущей версии Lomme', async () => {
    const app = await buildApp(new MemoryFinanceStore())
    const response = await app.inject({ method: 'GET', url: '/shortcut/install' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/shortcuts/Lomme%20%E2%80%94%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B0%D1%82%D1%8C%20%D1%82%D1%80%D0%B0%D1%82%D1%83.shortcut')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
