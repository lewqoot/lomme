import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { canGoForward, defaultPeriod, resolvePeriod, shiftPeriod, trendGranularity } from '../src/features/period/model.js'

const now = new Date('2026-08-26T12:00:00Z')
const day = (value: Date) => format(value, 'yyyy-MM-dd')

describe('модель периода', () => {
  it('месяц по умолчанию покрывает весь календарный месяц', () => {
    const period = resolvePeriod(defaultPeriod(now), now)
    expect(day(period.start)).toBe('2026-08-01')
    expect(day(period.end)).toBe('2026-08-31')
    expect(period.label).toBe('Этот месяц')
  })

  it('стрелка назад двигает якорь ровно на один период', () => {
    const previous = shiftPeriod({ mode: 'month', anchor: now.toISOString() }, -1)
    const period = resolvePeriod(previous, now)
    expect(day(period.start)).toBe('2026-07-01')
    expect(day(period.end)).toBe('2026-07-31')
  })

  it('не пускает вперёд дальше текущего момента', () => {
    expect(canGoForward({ mode: 'month', anchor: now.toISOString() }, now)).toBe(false)
    expect(canGoForward({ mode: 'month', anchor: '2026-06-15T00:00:00Z' }, now)).toBe(true)
  })

  it('скользящие окна не двигаются стрелками', () => {
    const last7 = { mode: 'last7' as const, anchor: now.toISOString() }
    expect(shiftPeriod(last7, -1)).toEqual(last7)
    expect(canGoForward(last7, now)).toBe(false)
    const period = resolvePeriod(last7, now)
    expect(day(period.start)).toBe('2026-08-20')
    expect(day(period.end)).toBe('2026-08-26')
  })

  it('неделя начинается с понедельника', () => {
    const period = resolvePeriod({ mode: 'week', anchor: now.toISOString() }, now)
    expect(day(period.start)).toBe('2026-08-24')
    expect(day(period.end)).toBe('2026-08-30')
  })

  it('пользовательский диапазон сдвигается на свою длину', () => {
    const custom = { mode: 'custom' as const, anchor: '2026-08-01T00:00:00Z', start: '2026-08-01T00:00:00Z', end: '2026-08-10T00:00:00Z' }
    const period = resolvePeriod(shiftPeriod(custom, -1), now)
    expect(day(period.start)).toBe('2026-07-22')
    expect(day(period.end)).toBe('2026-07-31')
  })

  it('длинные периоды переключают график на месячные корзины', () => {
    expect(trendGranularity(resolvePeriod({ mode: 'month', anchor: now.toISOString() }, now))).toBe('day')
    expect(trendGranularity(resolvePeriod({ mode: 'year', anchor: now.toISOString() }, now))).toBe('month')
  })
})
