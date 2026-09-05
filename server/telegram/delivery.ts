/**
 * Sends what the worker decided to send.
 *
 * Delivery is deliberately sequential and paced: Telegram allows about thirty
 * messages a second across a bot, and a burst that trips that limit costs more
 * time than the pause it skipped.
 */

import type { FinanceStore } from '../store/types.js'
import { sendMessage } from './api.js'
import { reminderDueAt } from './reminders.js'
import { dailyReminder } from './texts.js'

const PACING_MS = 40

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

export type DeliveryReport = { sent: number; skipped: number; failed: number; revoked: number }

export async function deliverDailyReminders(store: FinanceStore, now = new Date()): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, skipped: 0, failed: 0, revoked: 0 }
  const candidates = await store.reminderCandidates()

  for (const candidate of candidates) {
    const scheduledFor = reminderDueAt(candidate, now)
    if (!scheduledFor) { report.skipped += 1; continue }

    // Claiming before sending is what keeps two overlapping worker ticks from
    // greeting the same person twice.
    if (!(await store.claimReminderDelivery(candidate.userId, scheduledFor))) { report.skipped += 1; continue }

    const outcome = await sendMessage(candidate.telegramUserId, dailyReminder(candidate.deliveredCount))
    if (outcome.ok) {
      await store.settleReminderDelivery(candidate.userId, scheduledFor)
      report.sent += 1
    } else if (outcome.permanent) {
      // The chat is gone for good, so stop writing to it rather than failing
      // here again every evening.
      await store.settleReminderDelivery(candidate.userId, scheduledFor, outcome.description)
      await store.revokeBotWriteAccess(candidate.telegramUserId)
      report.revoked += 1
    } else {
      // Still inside tonight's window on the next tick, so give the slot back.
      await store.releaseReminderDelivery(candidate.userId, scheduledFor)
      report.failed += 1
    }
    await wait(outcome.ok === false && !outcome.permanent && outcome.retryAfter
      ? Math.min(outcome.retryAfter, 30) * 1000
      : PACING_MS)
  }

  return report
}
