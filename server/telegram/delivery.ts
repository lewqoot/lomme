/**
 * Sends what the schedules decided to send.
 *
 * Delivery is deliberately sequential and paced: Telegram allows about thirty
 * messages a second across a bot, and a burst that trips that limit costs more
 * time than the pause it skipped.
 *
 * Kinds run in priority order — monthly, weekly, then the daily reminder — and
 * a delivery of any kind suppresses the reminder later the same evening. Two
 * messages in one night is what people mute a bot for.
 */

import type { FinanceStore } from '../store/types.js'
import { sendMessage, type BotMessage } from './api.js'
import type { LinkContext } from './texts.js'
import {
  eveningSlot,
  lastMonthRange,
  lastWeekRange,
  previousWeekRange,
  monthlyDigestDueAt,
  reactivationDue,
  reminderDueAt,
  startOfLocalDay,
  weeklyDigestDueAt,
  type DeliveryKind,
  type ReminderCandidate,
} from './reminders.js'
import { dailyReminder, monthlyDigest, reactivation, sharedWalletDigest, weeklyDigest } from './texts.js'

const PACING_MS = 40

/**
 * Below this, a summary is arithmetic on too little: the same threshold the
 * insights screen uses before it makes any claim about a person's spending.
 */
const MIN_OBSERVED_DAYS = 7

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

export type DeliveryReport = { sent: number; skipped: number; failed: number; revoked: number }

type Planned = { kind: DeliveryKind; scheduledFor: Date; message: BotMessage }

export async function runDeliveries(store: FinanceStore, now = new Date(), links: LinkContext = { appUrl: null, botUsername: null }): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, skipped: 0, failed: 0, revoked: 0 }
  const candidates = await store.reminderCandidates()

  for (const candidate of candidates) {
    try {
      await deliverTo(store, candidate, now, links, report)
    } catch (error) {
      // One person's failure is not everyone's. Without this, an error while
      // building a digest — a missing wallet, a database hiccup — ended the
      // batch, and everybody queued behind them silently got nothing.
      report.failed += 1
      console.error(JSON.stringify({
        event: 'delivery_failed',
        userId: candidate.userId,
        error: error instanceof Error ? error.message : 'unknown',
      }))
    }
  }

  return report
}

async function deliverTo(
  store: FinanceStore,
  candidate: ReminderCandidate,
  now: Date,
  links: LinkContext,
  report: DeliveryReport,
) {
  {
    const planned = await planFor(store, candidate, now, links)
    if (!planned) { report.skipped += 1; return }

    // Claiming before sending is what keeps two overlapping worker ticks from
    // writing to the same person twice.
    if (!(await store.claimDelivery(candidate.userId, planned.kind, planned.scheduledFor))) {
      report.skipped += 1
      return
    }

    let outcome: Awaited<ReturnType<typeof sendMessage>>
    try {
      outcome = await sendMessage(candidate.telegramUserId, planned.message)
    } catch (error) {
      // The slot was claimed a moment ago; leaving it claimed would silence
      // this person for the rest of the evening over a transient failure.
      await store.releaseDelivery(candidate.userId, planned.kind, planned.scheduledFor)
      throw error
    }
    if (outcome.ok) {
      await store.settleDelivery(candidate.userId, planned.kind, planned.scheduledFor)
      report.sent += 1
    } else if (outcome.permanent) {
      // The chat is gone for good, so stop writing to it rather than failing
      // here again every evening.
      await store.settleDelivery(candidate.userId, planned.kind, planned.scheduledFor, outcome.description)
      await store.revokeBotWriteAccess(candidate.telegramUserId)
      report.revoked += 1
    } else {
      // Still inside tonight's window on the next tick, so give the slot back.
      await store.releaseDelivery(candidate.userId, planned.kind, planned.scheduledFor)
      report.failed += 1
    }

    const backOff = !outcome.ok && !outcome.permanent && outcome.retryAfter
      ? Math.min(outcome.retryAfter, 30) * 1000
      : PACING_MS
    await wait(backOff)
  }
}

/** The one message this person is owed right now, highest priority first. */
async function planFor(store: FinanceStore, candidate: ReminderCandidate, now: Date, links: LinkContext): Promise<Planned | null> {
  const monthly = monthlyDigestDueAt(candidate.timezone, now)
  if (monthly) {
    const message = await monthlyMessage(store, candidate, now)
    if (message) return { kind: 'monthly', scheduledFor: monthly, message }
  }

  const weekly = weeklyDigestDueAt(candidate.timezone, now)
  if (weekly) {
    const message = await weeklyMessage(store, candidate, now)
    if (message) return { kind: 'weekly', scheduledFor: weekly, message }
  }

  // The shared digest and the reminder share one evening slot, and the digest
  // wins: what other people recorded is news, a nudge is not.
  const evening = eveningSlot(candidate, now)
  if (evening) {
    const activity = await store.sharedActivitySince(candidate.userId, startOfLocalDay(candidate.timezone, now))
    if (activity) {
      return { kind: 'shared', scheduledFor: evening, message: sharedWalletDigest(activity.accountName, activity.byAuthor) }
    }
  }

  // A one-off outranks the nightly nudge: it says something the reminder
  // cannot, and it only ever gets one chance to say it.
  if (evening) {
    const kind = reactivationDue(candidate, now)
    if (kind) return { kind, scheduledFor: evening, message: reactivation(kind, links) }
  }

  const daily = reminderDueAt(candidate, now)
  return daily ? { kind: 'daily', scheduledFor: daily, message: dailyReminder(candidate.deliveredCount) } : null
}

async function summaryFor(store: FinanceStore, userId: string, range: { start: Date; end: Date }) {
  const snapshot = await store.snapshot(userId, undefined, { start: range.start.toISOString(), end: range.end.toISOString() })
  return snapshot.summary
}

/** Expense categories only, biggest first: a digest is about where money went. */
function topExpense(byCategory: Array<{ name: string; amountKopecks: number; type: 'income' | 'expense' }>, limit: number) {
  return byCategory.filter((item) => item.type === 'expense').slice(0, limit)
}

async function weeklyMessage(store: FinanceStore, candidate: ReminderCandidate, now: Date) {
  const range = lastWeekRange(candidate.timezone, now)
  const summary = await summaryFor(store, candidate.userId, range)
  // Nothing spent is not a story, and too few observed days is not a claim.
  if (!summary.expenseKopecks || summary.observedDayCount < MIN_OBSERVED_DAYS) return null

  const previous = await summaryFor(store, candidate.userId, previousWeekRange(candidate.timezone, now))
  // Only compare against a week that actually had spending in it.
  const comparable = previous.expenseKopecks > 0 ? previous.expenseKopecks : null

  return weeklyDigest({
    expenseKopecks: summary.expenseKopecks,
    previousExpenseKopecks: comparable,
    top: topExpense(summary.byCategory, 1),
  })
}

async function monthlyMessage(store: FinanceStore, candidate: ReminderCandidate, now: Date) {
  const range = lastMonthRange(candidate.timezone, now)
  const summary = await summaryFor(store, candidate.userId, range)
  if (!summary.expenseKopecks && !summary.incomeKopecks) return null
  if (summary.observedDayCount < MIN_OBSERVED_DAYS) return null

  return monthlyDigest({
    year: range.year,
    month: range.month,
    incomeKopecks: summary.incomeKopecks,
    expenseKopecks: summary.expenseKopecks,
    netKopecks: summary.netKopecks,
    top: topExpense(summary.byCategory, 3),
  })
}
