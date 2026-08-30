import { describe, expect, it } from 'vitest'
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '../src/features/editor/datetime.js'

describe('datetime-local операции', () => {
  it('не сдвигает время при открытии и сохранении без изменений', () => {
    const stored = '2026-08-20T10:00:00.000Z'
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(stored))).toBe(stored)
  })
})
