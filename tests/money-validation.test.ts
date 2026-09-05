import { describe, expect, it } from 'vitest'
import { createTransactionSchema, MAX_AMOUNT_KOPECKS } from '../src/shared/contracts.js'
import { parseQuickAmount } from '../src/shared/quick-entry.js'

const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36)
const base = {
  workspaceId: uuid(1),
  type: 'expense' as const,
  amountKopecks: 10_000,
  accountId: uuid(2),
  categoryId: uuid(4),
  occurredAt: '2026-09-01T10:00:00.000Z',
  note: '',
}
const check = (input: Record<string, unknown>) => createTransactionSchema.safeParse({ ...base, ...input })

describe('единая денежная валидация', () => {
  it('быстрый ввод подчиняется тому же потолку, что и ручной', () => {
    // Аудит: quick API принимал миллиард рублей, редактор — нет.
    expect(parseQuickAmount('999999999.99')).toBe(MAX_AMOUNT_KOPECKS)
    expect(parseQuickAmount('1000000000')).toBeNull()
    expect(check({ amountKopecks: MAX_AMOUNT_KOPECKS }).success).toBe(true)
    expect(check({ amountKopecks: MAX_AMOUNT_KOPECKS + 1 }).success).toBe(false)
  })

  it('не принимает ноль, отрицательные и дробные копейки', () => {
    expect(parseQuickAmount('0')).toBeNull()
    expect(parseQuickAmount('-5')).toBeNull()
    expect(check({ amountKopecks: 0 }).success).toBe(false)
    expect(check({ amountKopecks: 10.5 }).success).toBe(false)
  })

  it('счёт назначения бывает только у перевода', () => {
    // Аудит: такой расход попадал в журнал счёта назначения, не меняя баланс.
    expect(check({ type: 'expense', targetAccountId: uuid(3), categoryId: uuid(4) }).success).toBe(false)
    expect(check({ type: 'income', targetAccountId: uuid(3) }).success).toBe(false)
    expect(check({ type: 'transfer', targetAccountId: uuid(3), categoryId: null }).success).toBe(true)
  })

  it('перевод требует два разных счёта и не имеет категории', () => {
    expect(check({ type: 'transfer', categoryId: null }).success).toBe(false)
    expect(check({ type: 'transfer', targetAccountId: uuid(2), categoryId: null }).success).toBe(false)
    expect(check({ type: 'transfer', targetAccountId: uuid(3), categoryId: uuid(4) }).success).toBe(false)
  })

  it('обычная трата и доход проходят', () => {
    expect(check({ type: 'expense', categoryId: uuid(4) }).success).toBe(true)
    expect(check({ type: 'income', categoryId: uuid(4) }).success).toBe(true)
  })
})
