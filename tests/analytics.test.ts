import { describe, expect, it } from 'vitest'
import { calculateSummary, periodForMonth } from '../server/lib/analytics.js'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'

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
