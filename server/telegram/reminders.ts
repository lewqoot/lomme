/**
 * Decides which daily reminders are due right now.
 *
 * Kept as a pure function so every rule below — the person's own time zone, a
 * missed window, a day that already has entries — is tested against fixed
 * clocks rather than by waiting for evening.
 */

import { zonedDateKey, zonedMidnight, zonedParts } from '../../src/shared/timezone.js'

export type ReminderCandidate = {
  userId: string
  telegramUserId: number
  timezone: string
  /** "HH:MM" in the person's own time zone. */
  localTime: string
  /** ISO weekdays, Monday is 1. */
  daysOfWeek: number[]
  /** When this person last recorded anything, in any of their wallets. */
  lastEntryAt: Date | null
  /** Reminders already delivered, so the how-to-turn-this-off line can stop. */
  deliveredCount: number
  /** The last message of any kind the bot sent them, for the one-a-day rule. */
  lastDeliveryAt: Date | null
  /** When this person's account was created, for the onboarding series. */
  createdAt: Date
  /** How much they have recorded in total, ever. */
  entryCount: number
  /** Whether the iOS shortcut key has been issued. */
  hasQuickKey: boolean
  /** Whether any of their wallets has somebody else in it. */
  hasSharedWallet: boolean
  /** Which one-off messages already went out, so none is ever repeated. */
  sentKinds: ReadonlySet<string>
}

/** Every schedule the worker can send on, in the order it resolves conflicts. */
export type DeliveryKind = 'monthly' | 'weekly' | 'shared' | 'daily' | ReactivationKind

/**
 * Messages sent once in a person's life, each for a reason that stops being
 * true the moment it is acted on. They are recorded under their own kind, and
 * a kind that has been sent is never sent again.
 */
export type ReactivationKind = 'start-day1' | 'start-day3' | 'return' | 'tip-shortcut' | 'tip-family'

const DAY_MS = 86_400_000

/** Sunday evening, once the week is effectively over but before people turn in. */
const WEEKLY_HOUR = 19
/** Midday on the first, when a month's figures read as news rather than a chore. */
const MONTHLY_HOUR = 12

/**
 * A worker tick that runs late must not deliver last night's reminder at
 * breakfast. Two hours is long enough to survive a redeploy and short enough
 * that a delivered reminder still belongs to the evening it was meant for.
 */
const LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000

function localTimeParts(localTime: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** ISO weekday (Monday 1 … Sunday 7) of an instant, read in a time zone. */
export function zonedIsoWeekday(instant: Date, timeZone: string) {
  const { year, month, day } = zonedParts(instant, timeZone)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

/**
 * The instant today's reminder was scheduled for, or null when it should not
 * be sent: wrong weekday, not yet time, the window has passed, or this person
 * has already recorded something today.
 *
 * Silence is the reward for having kept the books, which is the whole reason
 * this is not a plain cron broadcast.
 */
export function reminderDueAt(candidate: ReminderCandidate, now: Date): Date | null {
  const scheduledFor = eveningSlot(candidate, now)
  if (!scheduledFor) return null
  // Nothing to remind about: they already recorded something today.
  if (sameLocalDay(candidate.lastEntryAt, now, candidate.timezone)) return null
  return scheduledFor
}

/**
 * The evening slot itself, without the reasons a reminder would decline it.
 * The shared-wallet digest and the reminder compete for this one moment, so
 * whichever wins, nobody gets two messages in a night.
 */
export function eveningSlot(candidate: ReminderCandidate, now: Date): Date | null {
  const time = localTimeParts(candidate.localTime)
  if (!time) return null
  if (!candidate.daysOfWeek.includes(zonedIsoWeekday(now, candidate.timezone))) return null
  const scheduledFor = atLocalHour(candidate.timezone, now, time.hour, time.minute)
  if (!withinWindow(scheduledFor, now)) return null
  if (sameLocalDay(candidate.lastDeliveryAt, now, candidate.timezone)) return null
  return scheduledFor
}

/** Local midnight of the day `now` falls on, for "since today started". */
export function startOfLocalDay(timeZone: string, now: Date) {
  const { year, month, day } = zonedParts(now, timeZone)
  return zonedMidnight(year, month, day, timeZone)
}

/** The instant of a wall-clock hour today, in the person's own zone. */
function atLocalHour(timeZone: string, now: Date, hour: number, minute = 0) {
  const { year, month, day } = zonedParts(now, timeZone)
  const midnight = zonedMidnight(year, month, day, timeZone)
  return new Date(midnight.getTime() + (hour * 60 + minute) * 60_000)
}

function withinWindow(scheduledFor: Date, now: Date) {
  const waited = now.getTime() - scheduledFor.getTime()
  return waited >= 0 && waited <= LATE_TOLERANCE_MS
}

function sameLocalDay(instant: Date | null, now: Date, timeZone: string) {
  return Boolean(instant) && zonedDateKey(instant!, timeZone) === zonedDateKey(now, timeZone)
}

/**
 * The one-off message this person is owed, if any. Checked in order, and the
 * first that applies wins; the rest keep waiting for their own conditions.
 *
 * Every branch is bounded by something that becomes false once acted upon —
 * a first entry, an installed shortcut, a second person in the wallet — so the
 * series ends on its own rather than by counting attempts.
 */
export function reactivationDue(candidate: ReminderCandidate, now: Date): ReactivationKind | null {
  const age = now.getTime() - candidate.createdAt.getTime()
  const silence = candidate.lastEntryAt ? now.getTime() - candidate.lastEntryAt.getTime() : null

  if (candidate.entryCount === 0) {
    // Two nudges, then silence. Somebody who has recorded nothing in three
    // days has answered the question.
    if (age >= 3 * DAY_MS) return unsent(candidate, 'start-day3')
    if (age >= DAY_MS) return unsent(candidate, 'start-day1')
    return null
  }

  // They used it and stopped. Worth one message, once.
  if (silence !== null && silence >= 7 * DAY_MS) return unsent(candidate, 'return')

  // Advice only makes sense to someone who has the habit already.
  if (!candidate.hasQuickKey && candidate.entryCount >= 5 && age >= 7 * DAY_MS) return unsent(candidate, 'tip-shortcut')
  if (!candidate.hasSharedWallet && candidate.entryCount >= 15 && age >= 14 * DAY_MS) {
    // Never straight after the shortcut tip: two pieces of advice in a row
    // read as a campaign rather than a suggestion.
    if (candidate.sentKinds.has('tip-shortcut') && !olderThanAWeek(candidate.lastDeliveryAt, now)) return null
    return unsent(candidate, 'tip-family')
  }
  return null
}

function unsent(candidate: ReminderCandidate, kind: ReactivationKind) {
  return candidate.sentKinds.has(kind) ? null : kind
}

function olderThanAWeek(instant: Date | null, now: Date) {
  return instant === null || now.getTime() - instant.getTime() >= 7 * DAY_MS
}

/** Sunday's wrap-up. Nothing about what was recorded suppresses it: unlike the
 * reminder, a digest is worth reading precisely because the week had entries. */
export function weeklyDigestDueAt(timeZone: string, now: Date): Date | null {
  if (zonedIsoWeekday(now, timeZone) !== 7) return null
  const scheduledFor = atLocalHour(timeZone, now, WEEKLY_HOUR)
  return withinWindow(scheduledFor, now) ? scheduledFor : null
}

export function monthlyDigestDueAt(timeZone: string, now: Date): Date | null {
  if (zonedParts(now, timeZone).day !== 1) return null
  const scheduledFor = atLocalHour(timeZone, now, MONTHLY_HOUR)
  return withinWindow(scheduledFor, now) ? scheduledFor : null
}

/**
 * The week a Sunday-evening digest reports on: Monday through the moment it is
 * sent. Ending at the previous midnight would leave Sunday's own spending out
 * of a message titled "Неделя закрыта".
 *
 * Day arithmetic goes through `zonedMidnight`, which resolves an out-of-range
 * day against the calendar, so a daylight-saving shift inside the week cannot
 * move the boundary by an hour.
 */
export function lastWeekRange(timeZone: string, now: Date) {
  const { year, month, day } = zonedParts(now, timeZone)
  return { start: zonedMidnight(year, month, day - 6, timeZone), end: now }
}

/** The seven days before that window, for the comparison line. */
export function previousWeekRange(timeZone: string, now: Date) {
  const { year, month, day } = zonedParts(now, timeZone)
  return {
    start: zonedMidnight(year, month, day - 13, timeZone),
    end: new Date(zonedMidnight(year, month, day - 6, timeZone).getTime() - 1),
  }
}

/** The month that just ended, and the one before it for comparison. */
export function lastMonthRange(timeZone: string, now: Date) {
  const { year, month } = zonedParts(now, timeZone)
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  const start = zonedMidnight(previousYear, previousMonth, 1, timeZone)
  const end = new Date(zonedMidnight(year, month, 1, timeZone).getTime() - 1)
  return { start, end, year: previousYear, month: previousMonth }
}
