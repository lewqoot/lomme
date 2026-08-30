import {
  addDays, addMonths, addWeeks, addYears, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, endOfYear,
  format, startOfDay, startOfMonth, startOfWeek, startOfYear, subDays, subMonths, subWeeks, subYears,
} from 'date-fns'
import { ru } from 'date-fns/locale'

export type PeriodMode = 'day' | 'week' | 'twoWeeks' | 'month' | 'year' | 'last7' | 'last30' | 'all' | 'custom'

/**
 * The one period object every screen shares. `anchor` is the day the preset is
 * measured from, so the arrows only ever move the anchor; `start`/`end` are set
 * for `custom` alone. Everything else is derived - keeping a resolved range in
 * state is what lets home, insights and analytics drift apart.
 */
export type PeriodSelection = {
  mode: PeriodMode
  anchor: string
  start?: string
  end?: string
}

export type ResolvedPeriod = { start: Date; end: Date; label: string; relative: boolean }

/** Presets in the order the reference popover lists them. */
export const PERIOD_PRESETS: { mode: PeriodMode; label: string }[] = [
  { mode: 'day', label: 'День' },
  { mode: 'week', label: 'Неделя' },
  { mode: 'twoWeeks', label: '2 недели' },
  { mode: 'month', label: 'Месяц' },
  { mode: 'year', label: 'Год' },
  { mode: 'last7', label: 'Последние 7 дней' },
  { mode: 'last30', label: 'Последние 30 дней' },
  { mode: 'all', label: 'Всё время' },
]

/** Rolling windows and "all time" are pinned to today, so their arrows are inert. */
const ROLLING: PeriodMode[] = ['last7', 'last30', 'all']
export const isRolling = (mode: PeriodMode) => ROLLING.includes(mode)

export const defaultPeriod = (now = new Date()): PeriodSelection => ({ mode: 'month', anchor: now.toISOString() })

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const WEEK = { weekStartsOn: 1 } as const

export function resolvePeriod(selection: PeriodSelection, now = new Date()): ResolvedPeriod {
  const anchor = new Date(selection.anchor)
  const sameDay = (left: Date, right: Date) => format(left, 'yyyy-MM-dd') === format(right, 'yyyy-MM-dd')

  switch (selection.mode) {
    case 'day':
      return {
        start: startOfDay(anchor), end: endOfDay(anchor),
        label: sameDay(anchor, now) ? 'Сегодня' : capitalise(format(anchor, 'd MMMM', { locale: ru })),
        relative: sameDay(anchor, now),
      }
    case 'week': {
      const start = startOfWeek(anchor, WEEK)
      return {
        start, end: endOfWeek(anchor, WEEK),
        label: sameDay(start, startOfWeek(now, WEEK)) ? 'Эта неделя' : `${format(start, 'd MMM', { locale: ru })} — ${format(endOfWeek(anchor, WEEK), 'd MMM', { locale: ru })}`,
        relative: sameDay(start, startOfWeek(now, WEEK)),
      }
    }
    case 'twoWeeks': {
      const start = startOfWeek(anchor, WEEK)
      const end = endOfWeek(addWeeks(start, 1), WEEK)
      return {
        start, end,
        label: `${format(start, 'd MMM', { locale: ru })} — ${format(end, 'd MMM', { locale: ru })}`,
        relative: false,
      }
    }
    case 'year': {
      const start = startOfYear(anchor)
      return {
        start, end: endOfYear(anchor),
        label: start.getFullYear() === now.getFullYear() ? 'Этот год' : String(start.getFullYear()),
        relative: start.getFullYear() === now.getFullYear(),
      }
    }
    case 'last7':
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now), label: 'Последние 7 дней', relative: true }
    case 'last30':
      return { start: startOfDay(subDays(now, 29)), end: endOfDay(now), label: 'Последние 30 дней', relative: true }
    case 'all':
      // Far enough back to cover any ledger without asking the server for bounds.
      return { start: new Date(2000, 0, 1), end: endOfDay(now), label: 'Всё время', relative: true }
    case 'custom': {
      const start = startOfDay(new Date(selection.start || selection.anchor))
      const end = endOfDay(new Date(selection.end || selection.anchor))
      return {
        start, end,
        label: `${format(start, 'd MMM', { locale: ru })} — ${format(end, 'd MMM yyyy', { locale: ru })}`,
        relative: false,
      }
    }
    case 'month':
    default: {
      const start = startOfMonth(anchor)
      const currentMonth = format(anchor, 'yyyy-MM') === format(now, 'yyyy-MM')
      return {
        start, end: endOfMonth(anchor),
        label: currentMonth ? 'Этот месяц' : capitalise(format(anchor, 'LLLL yyyy', { locale: ru })),
        relative: currentMonth,
      }
    }
  }
}

/** Arrows move the anchor by exactly one period; rolling windows cannot move. */
export function shiftPeriod(selection: PeriodSelection, direction: -1 | 1): PeriodSelection {
  if (isRolling(selection.mode)) return selection
  const anchor = new Date(selection.anchor)
  const step = <T,>(back: T, forward: T) => (direction === -1 ? back : forward)

  if (selection.mode === 'custom') {
    // Slide a custom range by its own length so stepping stays intuitive.
    const { start, end } = resolvePeriod(selection)
    const days = Math.max(1, differenceInCalendarDays(end, start) + 1)
    const nextStart = addDays(start, direction * days)
    return { ...selection, anchor: nextStart.toISOString(), start: nextStart.toISOString(), end: addDays(end, direction * days).toISOString() }
  }

  const moved = {
    day: step(subDays(anchor, 1), addDays(anchor, 1)),
    week: step(subWeeks(anchor, 1), addWeeks(anchor, 1)),
    twoWeeks: step(subWeeks(anchor, 2), addWeeks(anchor, 2)),
    month: step(subMonths(anchor, 1), addMonths(anchor, 1)),
    year: step(subYears(anchor, 1), addYears(anchor, 1)),
  }[selection.mode as 'day' | 'week' | 'twoWeeks' | 'month' | 'year']

  return { ...selection, anchor: moved.toISOString() }
}

/** No forward travel past now - the product does not forecast beyond the period. */
export function canGoForward(selection: PeriodSelection, now = new Date()): boolean {
  if (isRolling(selection.mode)) return false
  return resolvePeriod(shiftPeriod(selection, 1), now).start <= now
}

export const canGoBack = (selection: PeriodSelection) => !isRolling(selection.mode)

/**
 * Daily buckets read well up to about two months; past that the chart needs months,
 * which is exactly what the reference shows when the year preset is picked.
 */
export function trendGranularity(period: ResolvedPeriod): 'day' | 'month' {
  return differenceInCalendarDays(period.end, period.start) > 62 ? 'month' : 'day'
}

/** Stable cache/query key for a resolved range. */
export const periodKey = (period: ResolvedPeriod) =>
  `${format(period.start, 'yyyy-MM-dd')}_${format(period.end, 'yyyy-MM-dd')}`
