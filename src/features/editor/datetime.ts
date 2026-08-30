/** Convert an instant to the wall-clock value expected by datetime-local. */
export function toLocalDateTimeInput(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Convert a datetime-local wall-clock value back to the matching instant. */
export function fromLocalDateTimeInput(value: string) {
  return new Date(value).toISOString()
}
