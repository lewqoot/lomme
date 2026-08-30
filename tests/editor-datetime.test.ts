import { describe, expect, it } from 'vitest'
import { formatOperationDateLabel, fromLocalDateTimeInput, toLocalDateTimeInput } from '../src/features/editor/datetime.js'

describe('datetime-local операции', () => {
  it('не сдвигает время при открытии и сохранении без изменений', () => {
    const stored = '2026-08-20T10:00:00.000Z'
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(stored))).toBe(stored)
  })

  it('показывает реальный день и оставляет дату явно редактируемой', () => {
    const now = new Date(2026, 7, 30, 18, 0)
    expect(formatOperationDateLabel(new Date(2026, 7, 30, 14, 30), now)).toBe('Сегодня, 14:30')
    expect(formatOperationDateLabel(new Date(2026, 7, 29, 14, 30), now)).toBe('Вчера, 14:30')
    expect(formatOperationDateLabel(new Date(2026, 7, 20, 14, 30), now)).toBe('20 августа, 14:30')
  })
})
