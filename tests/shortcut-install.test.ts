import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('установка команды на iPhone', () => {
  const previous = process.env.VITE_SHORTCUT_ICLOUD_URL

  afterEach(() => {
    if (previous === undefined) delete process.env.VITE_SHORTCUT_ICLOUD_URL
    else process.env.VITE_SHORTCUT_ICLOUD_URL = previous
  })

  it('перенаправляет на опубликованную команду Apple', async () => {
    process.env.VITE_SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/7904d226526a4e64ac8fa14599f065f5'
    const app = await buildApp(new MemoryFinanceStore())
    const response = await app.inject({ method: 'GET', url: '/shortcut/install' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://www.icloud.com/shortcuts/7904d226526a4e64ac8fa14599f065f5')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('не позволяет переменной увести кнопку с домена Apple', async () => {
    process.env.VITE_SHORTCUT_ICLOUD_URL = 'https://example.com/not-a-shortcut'
    const app = await buildApp(new MemoryFinanceStore())
    const response = await app.inject({ method: 'GET', url: '/shortcut/install' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('https://www.icloud.com/shortcuts/')
  })
})
