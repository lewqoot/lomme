import { describe, expect, it } from 'vitest'
import type { LightMyRequestResponse } from 'fastify'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

async function session() {
  process.env.ALLOW_DEV_AUTH = 'true'
  const app = await buildApp(new MemoryFinanceStore())
  const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
  const raw = auth.headers['set-cookie']!
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]
  const key = (await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie } })).json().key as string
  const snapshot = async () => (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie } })).json()
  const quick = async (payload: Record<string, unknown>, bearer = key): Promise<LightMyRequestResponse> =>
    await app.inject({ method: 'POST', url: '/api/v1/quick', headers: { authorization: `Bearer ${bearer}` }, payload })
  return { app, cookie, key, snapshot, quick }
}

describe('быстрый ввод из шортката', () => {
  it('показывает только факт существования ключа', async () => {
    process.env.ALLOW_DEV_AUTH = 'true'
    const app = await buildApp(new MemoryFinanceStore())
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: '', timezone: 'Europe/Moscow' } })
    const raw = auth.headers['set-cookie']!
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]

    expect((await app.inject({ method: 'GET', url: '/api/v1/quick-key/status', headers: { cookie } })).json()).toEqual({ active: false })
    expect((await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/api/v1/quick-key/status', headers: { cookie } })).json()).toEqual({ active: true })
    expect((await app.inject({ method: 'GET', url: '/api/v1/quick-key/status' })).statusCode).toBe(401)
    await app.close()
  })

  it('выдаёт ключ и записывает трату, которая видна в приложении', async () => {
    const { app, snapshot, quick } = await session()
    const before = await snapshot()
    const balanceBefore = before.accounts.reduce((sum: number, item: { balanceKopecks: number }) => sum + item.balanceKopecks, 0)

    const response = await quick({ amount: '80', text: 'метро' })
    expect(response.statusCode).toBe(201)

    const after = await snapshot()
    const created = after.transactions.find((item: { id: string }) => item.id === response.json().id)
    expect(created.type).toBe('expense')
    expect(created.amountKopecks).toBe(8_000)
    expect(created.source).toBe('shortcut')
    const balanceAfter = after.accounts.reduce((sum: number, item: { balanceKopecks: number }) => sum + item.balanceKopecks, 0)
    expect(balanceBefore - balanceAfter).toBe(8_000)
    await app.close()
  })

  it('узнаёт категорию по тексту и помечает её как угаданную', async () => {
    const { app, snapshot, quick } = await session()
    const categories = (await snapshot()).categories
    const target = categories.find((item: { type: string }) => item.type === 'expense')

    const response = await quick({ amount: '250', text: target.name })
    expect(response.json().categoryName).toBe(target.name)
    const created = (await snapshot()).transactions.find((item: { id: string }) => item.id === response.json().id)
    expect(created.categoryId).toBe(target.id)
    expect(created.categoryGuessed).toBe(true)
    await app.close()
  })

  it('незнакомый текст оставляет без категории и не помечает угаданным', async () => {
    const { app, snapshot, quick } = await session()
    const response = await quick({ amount: '512', text: 'кое-что непонятное' })
    const created = (await snapshot()).transactions.find((item: { id: string }) => item.id === response.json().id)
    expect(created.categoryId).toBeNull()
    expect(created.categoryGuessed).toBe(false)
    expect(created.note).toBe('кое-что непонятное')
    await app.close()
  })

  it('чужой или пустой ключ ничего не записывает', async () => {
    const { app, snapshot, quick } = await session()
    const before = (await snapshot()).transactions.length
    expect((await quick({ amount: '80', text: 'метро' }, 'lom_подделка')).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/quick', payload: { amount: '80', text: '' } })).statusCode).toBe(401)
    expect((await snapshot()).transactions.length).toBe(before)
    await app.close()
  })

  it('не заменяет активный ключ без явного подтверждения', async () => {
    const { app, cookie, key, quick } = await session()
    const repeated = await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie } })
    expect(repeated.statusCode).toBe(409)
    expect(repeated.json().error.code).toBe('QUICK_KEY_EXISTS')
    expect((await quick({ amount: '80', text: 'метро' }, key)).statusCode).toBe(201)
    await app.close()
  })

  it('заменяет активный ключ только после явного подтверждения', async () => {
    const { app, cookie, key, quick } = await session()
    const next = (await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: { cookie }, payload: { replace: true } })).json().key
    expect(next).not.toBe(key)
    expect((await quick({ amount: '80', text: 'метро' }, key)).statusCode).toBe(401)
    expect((await quick({ amount: '80', text: 'метро' }, next)).statusCode).toBe(201)
    await app.close()
  })

  it('не принимает мусор вместо суммы', async () => {
    const { app, quick } = await session()
    for (const amount of ['', 'много', '-80', '0']) {
      expect((await quick({ amount, text: 'метро' })).statusCode).toBeGreaterThanOrEqual(400)
    }
    await app.close()
  })

  it('пишет трату по GET с ключом в Authorization и отвечает читаемой строкой', async () => {
    const { app, key, snapshot } = await session()
    const url = `/api/v1/quick?amount=1%20250%2C50&text=${encodeURIComponent('такси домой')}`
    const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    // ru-RU разделяет разряды неразрывным пробелом.
    expect(response.body.replace(/[\u00a0\u202f]/g, ' ')).toBe('Трата записана\n1 250,5 ₽\nКатегория: без категории')

    const created = (await snapshot()).transactions.find((item: { note: string | null }) => item.note === 'такси домой')
    expect(created.amountKopecks).toBe(125_050)
    expect(created.type).toBe('expense')
    expect(created.source).toBe('shortcut')
    await app.close()
  })

  it('разбирает сумму и описание из одного поля с ключом в Authorization', async () => {
    const { app, key, snapshot } = await session()
    const response = await app.inject({ method: 'GET', url: `/api/v1/quick?q=${encodeURIComponent('300 кофе')}`, headers: { authorization: `Bearer ${key}` } })
    expect(response.statusCode).toBe(200)

    const created = (await snapshot()).transactions.find((item: { note: string | null }) => item.note === 'кофе')
    expect(created.amountKopecks).toBe(30_000)

    // Без суммы записывать нечего — лучше ошибка, чем трата на 0.
    expect((await app.inject({ method: 'GET', url: '/api/v1/quick?q=%D1%82%D0%B0%D0%BA%D1%81%D0%B8', headers: { authorization: `Bearer ${key}` } })).statusCode).toBe(400)
    await app.close()
  })

  it('сумму без описания записывает без категории', async () => {
    const { app, cookie, key, snapshot } = await session()
    const before = await snapshot()
    const account = before.accounts[0]
    const category = before.categories.find((item: { type: string }) => item.type === 'expense')
    const manual = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: { cookie, 'idempotency-key': 'blank-note-before-quick-entry' },
      payload: {
        workspaceId: before.activeWorkspaceId,
        type: 'expense',
        amountKopecks: 450_00,
        accountId: account.id,
        categoryId: category.id,
        occurredAt: new Date().toISOString(),
        note: '',
        source: 'manual',
      },
    })
    expect(manual.statusCode).toBe(201)

    const response = await app.inject({ method: 'GET', url: '/api/v1/quick?q=100', headers: { authorization: `Bearer ${key}` } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('Трата записана\n100 ₽\nКатегория: без категории')

    const created = (await snapshot()).transactions.find((item: { source: string; amountKopecks: number }) =>
      item.source === 'shortcut' && item.amountKopecks === 10_000)
    expect(created.categoryId).toBeNull()
    expect(created.categoryGuessed).toBe(false)
    expect(created.note).toBe('')
    await app.close()
  })

  it('ссылка без ключа или с чужим ключом ничего не записывает', async () => {
    const { app, snapshot } = await session()
    const count = (await snapshot()).transactions.length
    const missing = await app.inject({ method: 'GET', url: '/api/v1/quick?amount=80' })
    expect(missing.statusCode).toBe(401)
    expect(missing.headers['content-type']).toContain('text/plain')
    expect(missing.body).toContain('Команда устарела')
    const invalid = await app.inject({ method: 'GET', url: '/api/v1/quick?key=lom_nope&amount=80' })
    expect(invalid.statusCode).toBe(401)
    expect(invalid.headers['content-type']).toContain('text/plain')
    expect(invalid.body).toContain('Настроить заново')
    expect((await snapshot()).transactions).toHaveLength(count)
    await app.close()
  })

  it('ключ не даёт делать ничего, кроме записи траты', async () => {
    const { app, key } = await session()
    const bearer = { authorization: `Bearer ${key}` }
    // Ключ — не сессия: обычные ручки его не принимают.
    expect((await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: bearer })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/quick-key', headers: bearer })).statusCode).toBe(401)
    await app.close()
  })
})
