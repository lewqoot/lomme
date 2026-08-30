import { endOfMonth, startOfMonth } from 'date-fns'

/** What the client sends: an explicit window, or nothing for the current month. */
export type SnapshotRange = { start?: string; end?: string }

export function resolveRange(range?: SnapshotRange, now = new Date()) {
  const start = range?.start ? new Date(range.start) : startOfMonth(now)
  const end = range?.end ? new Date(range.end) : endOfMonth(now)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { start: startOfMonth(now), end: endOfMonth(now) }
  }
  return { start, end }
}
