import { describe, expect, it } from 'vitest'
import { calculateSummary, periodForMonth } from '../server/lib/analytics.js'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'
import { hasReliableInsightSample, hasReliableRunwaySample, savedIncomePercent } from '../src/features/insights/reliability.js'

describe('financial analytics', () => {
  it('не считает переводы доходом или расходом и сохраняет точность до копейки', () => {
    const category: CategoryView = { id: crypto.randomUUID(), type: 'expense', name: 'Кафе', icon: '☕️', color: '#FFDFE2', parentId: null, order: 0, version: 1, archivedAt: null }
    const accountId = crypto.randomUUID()
    const at = '2026-08-10T10:00:00.000Z'
    const base = { accountId, targetAccountId: null, occurredAt: at, note: '', source: 'manual' as const, authorName: 'Алекс', version: 1 }
    const transactions: TransactionView[] = [
      { ...base, id: crypto.randomUUID(), type: 'income', amountKopecks: 100_000_01, categoryId: null },
      { ...base, id: crypto.randomUUID(), type: 'expense', amountKopecks: 12_345_67, categoryId: category.id },
      { ...base, id: crypto.randomUUID(), type: 'transfer', amountKopecks: 50_000_00, targetAccountId: crypto.randomUUID(), categoryId: null },
    ]
    const summary = calculateSummary(transactions, [category], periodForMonth(new Date('2026-08-15T12:00:00Z')))
    expect(summary.incomeKopecks).toBe(100_000_01)
    expect(summary.expenseKopecks).toBe(12_345_67)
    expect(summary.netKopecks).toBe(87_654_34)
  })
})

describe('достоверность инсайтов', () => {
  it('не приписывает пользователю дни до первой операции', () => {
    const accountId = crypto.randomUUID()
    const transaction: TransactionView = {
      id: crypto.randomUUID(), type: 'income', amountKopecks: 100_00, accountId,
      targetAccountId: null, categoryId: null, occurredAt: '2026-08-29T10:00:00.000Z',
      note: '', source: 'manual', authorName: 'Алекс', version: 1,
    }
    const summary = calculateSummary(
      [transaction], [],
      { start: new Date('2026-08-01T00:00:00.000Z'), end: new Date('2026-08-31T23:59:59.999Z') },
      new Date('2026-08-30T12:00:00.000Z'),
      'UTC',
    )
    expect(summary.observedDayCount).toBe(2)
    expect(summary.expenseFreeStreakDays).toBe(2)
    expect(hasReliableInsightSample(summary.observedDayCount)).toBe(false)
  })

  it('не округляет неполное сохранение дохода до 100%', () => {
    expect(savedIncomePercent(1_000_00, 1, 999_99)).toBe(99)
    expect(savedIncomePercent(1_000_00, 0, 1_000_00)).toBe(100)
  })

  it('не строит прогноз подушки по короткой или редкой истории', () => {
    expect(hasReliableRunwaySample(29, 100, 50_000)).toBe(false)
    expect(hasReliableRunwaySample(60, 9, 50_000)).toBe(false)
    expect(hasReliableRunwaySample(60, 20, 0)).toBe(false)
    expect(hasReliableRunwaySample(30, 10, 50_000)).toBe(true)
  })
})
