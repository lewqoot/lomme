import { format, isSameDay, subDays } from 'date-fns'
import { ru } from 'date-fns/locale'

/** Convert an instant to the wall-clock value expected by datetime-local. */
export function toLocalDateTimeInput(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Convert a datetime-local wall-clock value back to the matching instant. */
export function fromLocalDateTimeInput(value: string) {
  return new Date(value).toISOString()
}

/** Human label for the editable operation timestamp; literals stay outside format patterns. */
export function formatOperationDateLabel(value: string | Date, now = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value
  const time = format(date, 'HH:mm')
  if (isSameDay(date, now)) return `Сегодня, ${time}`
  if (isSameDay(date, subDays(now, 1))) return `Вчера, ${time}`
  return format(date, 'd MMMM, HH:mm', { locale: ru })
}
