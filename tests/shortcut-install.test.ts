import { describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('установка команды на iPhone', () => {
  it('нативная ссылка открывает системный импорт подписанной команды', async () => {
    const app = await buildApp(new MemoryFinanceStore())
    const response = await app.inject({ method: 'GET', url: '/shortcut/install' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('shortcuts://import-shortcut/?name=Lomme&url=https%3A%2F%2Flomme-production.up.railway.app%2Fshortcuts%2FLomme.shortcut')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
