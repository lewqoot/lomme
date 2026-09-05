import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'
import { runDeliveries } from '../server/telegram/delivery.js'
import {
  lastMonthRange, lastWeekRange, monthlyDigestDueAt, previousWeekRange,
  reactivationDue, reminderDueAt, weeklyDigestDueAt, zonedIsoWeekday, type ReminderCandidate,
} from '../server/telegram/reminders.js'

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
  lastDeliveryAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  entryCount: 12,
  hasQuickKey: true,
  hasSharedWallet: true,
  sentKinds: new Set<string>(),
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

  it('молчит, если сводка уже приходила сегодня', () => {
    const digested = candidate({ lastDeliveryAt: new Date('2026-09-07T16:00:00Z') })

    expect(reminderDueAt(digested, MONDAY_EVENING)).toBeNull()
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


/** Sunday 6 September 2026, 19:05 in Moscow. */
const SUNDAY_EVENING = new Date('2026-09-06T16:05:00Z')
/** Tuesday 1 September 2026, 12:05 in Moscow. */
const FIRST_OF_MONTH = new Date('2026-09-01T09:05:00Z')

describe('расписание сводок', () => {
  const zone = 'Europe/Moscow'

  it('недельная уходит вечером в воскресенье', () => {
    expect(weeklyDigestDueAt(zone, SUNDAY_EVENING)?.toISOString()).toBe('2026-09-06T16:00:00.000Z')
    expect(weeklyDigestDueAt(zone, MONDAY_EVENING)).toBeNull()
    expect(weeklyDigestDueAt(zone, new Date('2026-09-06T13:00:00Z'))).toBeNull()
  })

  it('месячная уходит в полдень первого числа', () => {
    expect(monthlyDigestDueAt(zone, FIRST_OF_MONTH)?.toISOString()).toBe('2026-09-01T09:00:00.000Z')
    expect(monthlyDigestDueAt(zone, SUNDAY_EVENING)).toBeNull()
  })

  it('неделя считается с понедельника по текущий момент', () => {
    const range = lastWeekRange(zone, SUNDAY_EVENING)

    // Понедельник 31 августа, 00:00 по Москве — это 20:00 UTC 30 августа.
    expect(range.start.toISOString()).toBe('2026-08-30T21:00:00.000Z')
    expect(range.end).toBe(SUNDAY_EVENING)
  })

  it('предыдущая неделя примыкает к текущей, не перекрывая её', () => {
    const current = lastWeekRange(zone, SUNDAY_EVENING)
    const previous = previousWeekRange(zone, SUNDAY_EVENING)

    expect(previous.end.getTime()).toBe(current.start.getTime() - 1)
    expect(current.start.getTime() - previous.start.getTime()).toBe(7 * 86_400_000)
  })

  it('месячная сводка описывает прошедший месяц целиком', () => {
    const range = lastMonthRange(zone, FIRST_OF_MONTH)

    expect(range).toMatchObject({ year: 2026, month: 8 })
    expect(range.start.toISOString()).toBe('2026-07-31T21:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-08-31T20:59:59.999Z')
  })

  it('в январе отматывает на декабрь прошлого года', () => {
    const range = lastMonthRange(zone, new Date('2026-01-01T09:05:00Z'))

    expect(range).toMatchObject({ year: 2025, month: 12 })
  })
})

describe('одноразовые сообщения', () => {
  const DAY = 86_400_000
  const now = MONDAY_EVENING
  const aged = (days: number, overrides: Partial<ReminderCandidate> = {}) =>
    candidate({ createdAt: new Date(now.getTime() - days * DAY), ...overrides })

  it('в первый день молчит, на второй зовёт начать', () => {
    expect(reactivationDue(aged(0.5, { entryCount: 0, lastEntryAt: null }), now)).toBeNull()
    expect(reactivationDue(aged(1, { entryCount: 0, lastEntryAt: null }), now)).toBe('start-day1')
  })

  it('на третий день делает последнюю попытку и больше не возвращается', () => {
    const silent = aged(3, { entryCount: 0, lastEntryAt: null })
    expect(reactivationDue(silent, now)).toBe('start-day3')

    const answered = aged(10, { entryCount: 0, lastEntryAt: null, sentKinds: new Set(['start-day1', 'start-day3']) })
    expect(reactivationDue(answered, now)).toBeNull()
  })

  it('зовёт вернуться после недели тишины, но только раз', () => {
    const lapsed = { entryCount: 30, lastEntryAt: new Date(now.getTime() - 8 * DAY) }
    expect(reactivationDue(aged(60, lapsed), now)).toBe('return')
    expect(reactivationDue(aged(60, { ...lapsed, sentKinds: new Set(['return']) }), now)).toBeNull()
  })

  it('советует шорткат только тому, кто уже втянулся', () => {
    const base = { hasQuickKey: false, lastEntryAt: new Date(now.getTime() - DAY) }
    expect(reactivationDue(aged(8, { ...base, entryCount: 2 }), now)).toBeNull()
    expect(reactivationDue(aged(3, { ...base, entryCount: 20 }), now)).toBeNull()
    expect(reactivationDue(aged(8, { ...base, entryCount: 20 }), now)).toBe('tip-shortcut')
  })

  it('перестаёт советовать шорткат, когда он поставлен', () => {
    const installed = aged(30, { hasQuickKey: true, entryCount: 20, lastEntryAt: new Date(now.getTime() - DAY) })

    expect(reactivationDue(installed, now)).toBeNull()
  })

  it('предлагает общий кошелёк, но не следом за советом про шорткат', () => {
    const ready = {
      hasQuickKey: true, hasSharedWallet: false, entryCount: 20,
      lastEntryAt: new Date(now.getTime() - DAY),
    }
    expect(reactivationDue(aged(20, ready), now)).toBe('tip-family')

    // Совет про шорткат ушёл вчера — вторая рекомендация подряд подождёт.
    const justAdvised = aged(20, { ...ready, sentKinds: new Set(['tip-shortcut']), lastDeliveryAt: new Date(now.getTime() - DAY) })
    expect(reactivationDue(justAdvised, now)).toBeNull()

    const advisedLongAgo = aged(20, { ...ready, sentKinds: new Set(['tip-shortcut']), lastDeliveryAt: new Date(now.getTime() - 10 * DAY) })
    expect(reactivationDue(advisedLongAgo, now)).toBe('tip-family')
  })

  it('ничего не предлагает тому, у кого всё уже есть', () => {
    const settled = aged(90, { entryCount: 100, lastEntryAt: new Date(now.getTime() - DAY), hasQuickKey: true, hasSharedWallet: true })

    expect(reactivationDue(settled, now)).toBeNull()
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

    const first = await runDeliveries(store, MONDAY_EVENING)
    const second = await runDeliveries(store, MONDAY_EVENING)

    expect(first).toMatchObject({ sent: 1 })
    expect(second).toMatchObject({ sent: 0, skipped: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('напомнить про траты')
  })

  it('в первых напоминаниях объясняет, где их выключить', async () => {
    await enableReminders()
    const sent = telegram(200, { ok: true, result: { message_id: 1 } })

    await runDeliveries(store, MONDAY_EVENING)

    expect(sent[0]).toContain('раздел «Уведомления»')
  })

  it('перестаёт писать тому, кто заблокировал бота', async () => {
    await enableReminders()
    telegram(403, { ok: false, description: 'Forbidden: bot was blocked by the user' })

    const report = await runDeliveries(store, MONDAY_EVENING)

    expect(report).toMatchObject({ revoked: 1, sent: 0 })
    expect(await store.reminderCandidates()).toHaveLength(0)
  })

  it('возвращает слот в оборот после временной ошибки', async () => {
    await enableReminders()
    telegram(500, { ok: false, description: 'Internal Server Error' })
    expect(await runDeliveries(store, MONDAY_EVENING)).toMatchObject({ failed: 1 })

    const sent = telegram(200, { ok: true, result: { message_id: 2 } })
    expect(await runDeliveries(store, MONDAY_EVENING)).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(1)
  })

  it('не трогает того, кто напоминания не включал', async () => {
    const sent = telegram(200, { ok: true, result: { message_id: 1 } })

    const report = await runDeliveries(store, MONDAY_EVENING)

    expect(report).toMatchObject({ sent: 0 })
    expect(sent).toHaveLength(0)
  })
})

/** Воскресенье 1 марта 2026, 19:05 в Москве — заведомо в прошлом, иначе
 *  расчёт сводки обрежет период по реальным «сейчас». */
const PAST_SUNDAY_EVENING = new Date('2026-03-01T16:05:00Z')

describe('сводка за неделю', () => {
  let store: MemoryFinanceStore
  let userId: string

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    store = new MemoryFinanceStore()
    const session = await store.createSession({ id: 555, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru', allowsWriteToPm: true }, 'Europe/Moscow')
    userId = session.user.id
    await store.saveReminderSettings(userId, { enabled: true, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  function telegram() {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) sent.push(JSON.parse(String(init?.body)).text as string)
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    return sent
  }

  /** Записывает расход на указанный день недели закрывающейся недели. */
  async function spend(snapshot: Awaited<ReturnType<MemoryFinanceStore['snapshot']>>, occurredAt: string, amountKopecks: number, categoryName: string) {
    const category = snapshot.categories.find((item) => item.name === categoryName && item.type === 'expense')!
    await store.createTransaction(userId, {
      workspaceId: snapshot.activeWorkspaceId,
      type: 'expense',
      amountKopecks,
      accountId: snapshot.activeAccountId ?? snapshot.accounts[0]!.id,
      categoryId: category.id,
      occurredAt,
      note: '',
      source: 'manual',
    }, `seed-${occurredAt}-${amountKopecks}`)
  }

  it('складывает неделю и сравнивает с предыдущей', async () => {
    const snapshot = await store.snapshot(userId)
    // Закрывающаяся неделя: понедельник 23 февраля — воскресенье 1 марта.
    await spend(snapshot, '2026-02-23T09:00:00.000Z', 400_000, 'Продукты')
    await spend(snapshot, '2026-02-26T09:00:00.000Z', 80_000, 'Продукты')
    await spend(snapshot, '2026-03-01T09:00:00.000Z', 60_000, 'Транспорт')
    // Предыдущая неделя: 16–22 февраля.
    await spend(snapshot, '2026-02-17T09:00:00.000Z', 700_000, 'Продукты')
    const sent = telegram()

    const report = await runDeliveries(store, PAST_SUNDAY_EVENING)

    expect(report).toMatchObject({ sent: 1 })
    expect(sent[0]).toContain('Неделя закрыта')
    // 5 400 ₽ за неделю против 7 000 ₽ неделей раньше — на 1 600 ₽ меньше.
    expect(sent[0]!.replace(/[\u00a0\u202f]/g, ' ')).toContain('Потратил 5 400 ₽ — на 1 600 ₽ меньше')
    expect(sent[0]).toContain('Больше всего ушло на Продукты')
  })

  it('без сравнения, когда предыдущей недели не было', async () => {
    const snapshot = await store.snapshot(userId)
    await spend(snapshot, '2026-02-23T09:00:00.000Z', 150_000, 'Продукты')
    await spend(snapshot, '2026-03-01T09:00:00.000Z', 50_000, 'Продукты')
    const sent = telegram()

    await runDeliveries(store, PAST_SUNDAY_EVENING)

    expect(sent[0]!.replace(/[\u00a0\u202f]/g, ' ')).toContain('Потратил 2 000 ₽.')
    expect(sent[0]).not.toContain('чем неделей раньше')
  })

  it('молчит, когда наблюдений меньше недели', async () => {
    const snapshot = await store.snapshot(userId)
    // Одна запись в субботу: наблюдений два дня, выводы делать не на чем.
    await spend(snapshot, '2026-02-28T09:00:00.000Z', 90_000, 'Продукты')
    const sent = telegram()

    await runDeliveries(store, PAST_SUNDAY_EVENING)

    expect(sent).toHaveLength(0)
  })

  it('в воскресенье шлёт сводку вместо напоминания', async () => {
    const snapshot = await store.snapshot(userId)
    await spend(snapshot, '2026-02-23T09:00:00.000Z', 200_000, 'Продукты')
    await spend(snapshot, '2026-03-01T09:00:00.000Z', 100_000, 'Продукты')
    const sent = telegram()

    await runDeliveries(store, PAST_SUNDAY_EVENING)
    // Через час наступает время ежедневного напоминания — второго сообщения быть не должно.
    await runDeliveries(store, new Date('2026-03-01T17:05:00Z'))

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Неделя закрыта')
  })
})

describe('дайджест общего кошелька', () => {
  let store: MemoryFinanceStore
  let owner: Awaited<ReturnType<MemoryFinanceStore['createSession']>>
  let guest: Awaited<ReturnType<MemoryFinanceStore['createSession']>>

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    store = new MemoryFinanceStore()
    owner = await store.createSession({ id: 901, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru', allowsWriteToPm: true }, 'Europe/Moscow')
    guest = await store.createSession({ id: 902, firstName: 'Ирина', lastName: null, username: 'irina', languageCode: 'ru', allowsWriteToPm: true }, 'Europe/Moscow')
    const snapshot = await store.snapshot(owner.user.id)
    const invite = await store.createAccountInvite(owner.user.id, snapshot.activeAccountId!)
    await store.acceptAccountInvite(guest.user.id, invite.token)
    await store.saveReminderSettings(owner.user.id, { enabled: true, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  function telegram() {
    const sent: Array<{ chatId: number; text: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) {
        const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string }
        sent.push({ chatId: body.chat_id, text: body.text })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    return sent
  }

  async function spendAs(userId: string, amountKopecks: number, key: string) {
    const snapshot = await store.snapshot(userId)
    await store.createTransaction(userId, {
      workspaceId: snapshot.activeWorkspaceId,
      type: 'expense',
      amountKopecks,
      accountId: snapshot.activeAccountId!,
      categoryId: null,
      occurredAt: MONDAY_EVENING.toISOString(),
      note: '',
      source: 'manual',
    }, key)
  }

  it('рассказывает владельцу, что записал второй участник', async () => {
    await spendAs(guest.user.id, 560_000, 'guest-1')
    await spendAs(guest.user.id, 40_000, 'guest-2')
    const sent = telegram()

    const report = await runDeliveries(store, MONDAY_EVENING)

    expect(report).toMatchObject({ sent: 1 })
    expect(sent[0]!.chatId).toBe(901)
    expect(sent[0]!.text).toContain('Сегодня в «Кошелёк»')
    expect(sent[0]!.text.replace(/[\u00a0\u202f]/g, ' ')).toContain('Ирина — 2 записи на 6 000 ₽')
  })

  it('не пересказывает человеку его собственные траты', async () => {
    await spendAs(owner.user.id, 100_000, 'own-1')
    const sent = telegram()

    await runDeliveries(store, MONDAY_EVENING)

    // Записи за сегодня есть, значит и напоминание не нужно: тишина.
    expect(sent).toHaveLength(0)
  })

  it('вместо дайджеста шлёт напоминание, когда в кошельке пусто', async () => {
    const sent = telegram()

    await runDeliveries(store, MONDAY_EVENING)

    expect(sent[0]!.text).toContain('напомнить про траты')
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
