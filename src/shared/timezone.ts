type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string) {
  let value = formatters.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, value)
  }
  return value
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date)
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour'),
    minute: number('minute'),
    second: number('second'),
  }
}

export function zonedDateKey(date: Date, timeZone: string) {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function zonedDayNumber(date: Date, timeZone: string) {
  const { year, month, day } = zonedParts(date, timeZone)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** Resolve a wall-clock midnight in an IANA time zone to its UTC instant. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const normalized = new Date(Date.UTC(year, month - 1, day))
  const target = Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), normalized.getUTCDate())
  let instant = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(instant), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const correction = target - represented
    instant += correction
    if (correction === 0) break
  }
  return new Date(instant)
}
