import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { runDeliveries } from '../server/telegram/delivery.js'
import { sendMessage } from '../server/telegram/api.js'

/** Понедельник, 20:05 по Москве — время вечернего напоминания. */
const EVENING = new Date('2026-09-07T17:05:00Z')

describe('устойчивость рассылки', () => {
  let store: MemoryFinanceStore

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    store = new MemoryFinanceStore()
    for (const id of [101, 102, 103]) {
      await store.createSession(
        { id, firstName: `Человек${id}`, lastName: null, username: `u${id}`, languageCode: 'ru', allowsWriteToPm: true },
        'Europe/Moscow')
    }
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('сетевой сбой становится обычным ответом, а не исключением', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    const outcome = await sendMessage(900, { text: 'проверка' })

    expect(outcome).toMatchObject({ ok: false, permanent: false })
    if (outcome.ok) throw new Error('ожидали отказ')
    expect(outcome.description).toContain('fetch failed')
  })

  it('таймаут не остаётся висеть и тоже возвращает отказ', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      // Так ведёт себя fetch, когда срабатывает AbortSignal.timeout.
      const error = new Error('The operation was aborted due to timeout')
      error.name = 'TimeoutError'
      expect(init?.signal).toBeDefined()
      throw error
    }))

    const outcome = await sendMessage(900, { text: 'проверка' })

    if (outcome.ok) throw new Error('ожидали отказ')
    expect(outcome.permanent).toBe(false)
    expect(outcome.description).toContain('timed out')
  })

  it('падение на одном человеке не останавливает остальных', async () => {
    const delivered: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const chatId = JSON.parse(String(init?.body)).chat_id as number
      if (chatId === 102) throw new Error('внезапный сбой')
      delivered.push(chatId)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const report = await runDeliveries(store, EVENING)

    // Двое получили напоминание, третий учтён как неудача — и не съел остальных.
    expect(delivered.sort()).toEqual([101, 103])
    expect(report).toMatchObject({ sent: 2, failed: 1 })
  })

  it('после сбоя слот свободен и следующий прогон доставляет', async () => {
    let firstAttempt = true
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const chatId = JSON.parse(String(init?.body)).chat_id as number
      if (chatId === 102 && firstAttempt) { firstAttempt = false; throw new Error('внезапный сбой') }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await runDeliveries(store, EVENING)
    const second = await runDeliveries(store, EVENING)

    // Первым прогоном 102 не получил ничего; вторым — получил, слот не завис.
    expect(second).toMatchObject({ sent: 1 })
  })
})
