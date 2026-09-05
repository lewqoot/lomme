import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { deliverDailyReminders } from '../server/telegram/delivery.js'
import { reminderDueAt, zonedIsoWeekday, type ReminderCandidate } from '../server/telegram/reminders.js'

/** Monday 7 September 2026, 20:05 in Moscow — five minutes past the default. */
const MONDAY_EVENING = new Date('2026-09-07T17:05:00Z')

const candidate = (overrides: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  userId: 'user-1',
  telegramUserId: 777,
  timezone: 'Europe/Moscow',
  localTime: '20:00',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  lastEntryAt: null,
  deliveredCount: 0,
  ...overrides,
})

describe('когда напоминание уходит', () => {
  it('в назначенное время по часовому поясу человека', () => {
    const due = reminderDueAt(candidate(), MONDAY_EVENING)

    expect(due?.toISOString()).toBe('2026-09-07T17:00:00.000Z')
  })

  it('уважает чужой часовой пояс', () => {
    // Во Владивостоке 20:00 наступает на семь часов раньше московских.
    const vladivostok = candidate({ timezone: 'Asia/Vladivostok' })
    expect(reminderDueAt(vladivostok, MONDAY_EVENING)).toBeNull()
    expect(reminderDueAt(vladivostok, new Date('2026-09-07T10:05:00Z'))?.toISOString())
      .toBe('2026-09-07T10:00:00.000Z')
  })

  it('молчит, пока время не пришло', () => {
    expect(reminderDueAt(candidate(), new Date('2026-09-07T16:30:00Z'))).toBeNull()
  })

  it('не догоняет человека ночью, если тик пропустили', () => {
    // Через три часа после назначенного — окно уже закрыто.
    expect(reminderDueAt(candidate(), new Date('2026-09-07T20:05:00Z'))).toBeNull()
  })

  it('пропускает день, которого нет в расписании', () => {
    expect(reminderDueAt(candidate({ daysOfWeek: [6, 7] }), MONDAY_EVENING)).toBeNull()
  })

  it('молчит, когда за сегодня записи уже есть', () => {
    const recordedToday = candidate({ lastEntryAt: new Date('2026-09-07T09:00:00Z') })

    expect(reminderDueAt(recordedToday, MONDAY_EVENING)).toBeNull()
  })

  it('приходит, если последняя запись была вчера', () => {
    const recordedYesterday = candidate({ lastEntryAt: new Date('2026-09-06T18:00:00Z') })

    expect(reminderDueAt(recordedYesterday, MONDAY_EVENING)).not.toBeNull()
  })

  it('считает записи по местной дате, а не по UTC', () => {
    // 22:30 по Москве — это ещё сегодня, хотя в UTC уже 19:30 того же дня.
    const lateEntry = candidate({ localTime: '23:00', lastEntryAt: new Date('2026-09-07T19:30:00Z') })

    expect(reminderDueAt(lateEntry, new Date('2026-09-07T20:05:00Z'))).toBeNull()
  })

  it('отбрасывает испорченное время вместо падения', () => {
    expect(reminderDueAt(candidate({ localTime: '25:00' }), MONDAY_EVENING)).toBeNull()
    expect(reminderDueAt(candidate({ localTime: 'вечером' }), MONDAY_EVENING)).toBeNull()
  })

  it('считает воскресенье седьмым днём, а не нулевым', () => {
    expect(zonedIsoWeekday(new Date('2026-09-06T12:00:00Z'), 'Europe/Moscow')).toBe(7)
    expect(zonedIsoWeekday(MONDAY_EVENING, 'Europe/Moscow')).toBe(1)
  })
})

describe('доставка напоминаний', () => {
  let store: MemoryFinanceStore
  let userId: string

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    store = new MemoryFinanceStore()
    // allowsWriteToPm стоит только у того, кто разрешил боту писать.
    const session = await store.createSession({ id: 777, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru', allowsWriteToPm: true }, 'Europe/Moscow')
    userId = session.user.id
  })

  afterEach(() => { vi.unstubAllGlobals() })

  async function enableReminders() {
    await store.saveReminderSettings(userId, { enabled: true, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })
  }

  function telegram(status: number, body: unknown) {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }))
    return sent
  }

  it('отправляет один раз за вечер, сколько бы тиков ни было', async () => {
    await enableReminders()
    const sent = telegram(200, { ok: true, result: { message_id: 1 } })

    const first = await deliverDailyReminders(store, MONDAY_EVENING)
    const second = await deliverDailyReminders(store, MONDAY_EVENING)

    expect(first).toMatchObject({ sent: 1 })
    expect(second).toMatchObject({ sent: 0, skipped: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('напомнить про траты')
  })

  it('в первых напоминаниях объясняет, где их выключить', async () => {
    await enableReminders()
    const sent = telegram(200, { ok: true, result: { message_id: 1 } })

    await deliverDailyReminders(store, MONDAY_EVENING)

    expect(sent[0]).toContain('раздел «Уведомления»')
  })

  it('перестаёт писать тому, кто заблокировал бота', async () => {
    await enableReminders()
    telegram(403, { ok: false, description: 'Forbidden: bot was blocked by the user' })

    const report = await deliverDailyReminders(store, MONDAY_EVENING)

    expect(report).toMatchObject({ revoked: 1, sent: 0 })
    expect(await store.reminderCandidates()).toHaveLength(0)
  })

  it('возвращает слот в оборот после временной ошибки', async () => {
    await enableReminders()
    telegram(500, { ok: false, description: 'Internal Server Error' })
    expect(await deliverDailyReminders(store, MONDAY_EVENING)).toMatchObject({ failed: 1 })

    const sent = telegram(200, { ok: true, result: { message_id: 2 } })
    expect(await deliverDailyReminders(store, MONDAY_EVENING)).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(1)
  })

  it('не трогает того, кто напоминания не включал', async () => {
    const sent = telegram(200, { ok: true, result: { message_id: 1 } })

    const report = await deliverDailyReminders(store, MONDAY_EVENING)

    expect(report).toMatchObject({ sent: 0 })
    expect(sent).toHaveLength(0)
  })
})

describe('настройки напоминаний через API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore
  let cookie: string

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
    const session = await store.createSession({ id: 4242, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }, 'Europe/Moscow')
    cookie = `lomme_session=${session.token}`
  })

  afterEach(async () => { await app.close() })

  it('по умолчанию выключены', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/reminders', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ enabled: false, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })
  })

  it('сохраняет время и дни', async () => {
    const response = await app.inject({
      method: 'PATCH', url: '/api/v1/reminders', headers: { cookie },
      payload: { enabled: true, localTime: '09:30', daysOfWeek: [3, 1, 5] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ enabled: true, localTime: '09:30', daysOfWeek: [1, 3, 5] })
  })

  it('отклоняет невозможное время и пустую неделю', async () => {
    for (const payload of [
      { enabled: true, localTime: '25:00', daysOfWeek: [1] },
      { enabled: true, localTime: '9:30', daysOfWeek: [1] },
      { enabled: true, localTime: '09:30', daysOfWeek: [] },
      { enabled: true, localTime: '09:30', daysOfWeek: [8] },
    ]) {
      const response = await app.inject({ method: 'PATCH', url: '/api/v1/reminders', headers: { cookie }, payload })
      expect(response.statusCode).toBe(400)
    }
  })

  it('не отдаёт настройки без сессии', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/reminders' })).statusCode).toBe(401)
  })
})
