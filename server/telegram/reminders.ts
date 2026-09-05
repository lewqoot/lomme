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
}

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
  const time = localTimeParts(candidate.localTime)
  if (!time) return null
  if (!candidate.daysOfWeek.includes(zonedIsoWeekday(now, candidate.timezone))) return null

  const { year, month, day } = zonedParts(now, candidate.timezone)
  const midnight = zonedMidnight(year, month, day, candidate.timezone)
  const scheduledFor = new Date(midnight.getTime() + (time.hour * 60 + time.minute) * 60_000)

  const waited = now.getTime() - scheduledFor.getTime()
  if (waited < 0 || waited > LATE_TOLERANCE_MS) return null

  if (candidate.lastEntryAt
    && zonedDateKey(candidate.lastEntryAt, candidate.timezone) === zonedDateKey(now, candidate.timezone)) return null

  return scheduledFor
}
