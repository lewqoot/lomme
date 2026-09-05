import { describe, expect, it } from 'vitest'
import { buildFilteredTrend, buildSlices, sliceKey } from '../src/features/analytics/model.js'
import { calculateSummary } from '../src/shared/summary.js'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'

const categories: CategoryView[] = [
  { id: 'food', type: 'expense', name: 'Продукты', icon: 'basket', color: '#F0A000', parentId: null, order: 0, version: 1, archivedAt: null },
  { id: 'transport', type: 'expense', name: 'Транспорт', icon: 'car', color: '#00A0F0', parentId: null, order: 1, version: 1, archivedAt: null },
]
const base = { accountId: 'account', targetAccountId: null, note: '', source: 'manual' as const, authorName: 'Алекс', version: 1 }
const expense = (id: string, categoryId: string | null, amountKopecks: number, occurredAt: string): TransactionView => ({ ...base, id, type: 'expense', categoryId, amountKopecks, occurredAt })

describe('линейный график с фильтрами категорий', () => {
  const summary = calculateSummary([
    expense('food-1', 'food', 10_000, '2026-09-01T10:00:00.000Z'),
    expense('transport-1', 'transport', 30_000, '2026-09-01T11:00:00.000Z'),
    expense('food-2', 'food', 20_000, '2026-09-02T10:00:00.000Z'),
    expense('other', null, 5_000, '2026-09-02T11:00:00.000Z'),
  ], categories, { start: new Date('2026-09-01T00:00:00.000Z'), end: new Date('2026-09-30T23:59:59.999Z') })

  it.each([
    new Set<string>(),
    new Set([sliceKey('expense', 'food')]),
    new Set([sliceKey('expense', 'transport'), sliceKey('expense', null)]),
  ])('сумма точек совпадает с показанным итогом', (excluded) => {
    const trend = buildFilteredTrend(summary, 'expense', excluded)
    const slices = buildSlices(summary, 'expense', excluded)
    expect(trend.reduce((sum, point) => sum + point.expenseKopecks, 0)).toBe(slices.totalKopecks)
  })

  it('отключение всех категорий даёт нулевую линию', () => {
    const excluded = new Set(summary.byCategory.filter((item) => item.type === 'expense').map((item) => sliceKey('expense', item.categoryId)))
    const trend = buildFilteredTrend(summary, 'expense', excluded)
    expect(trend.every((point) => point.expenseKopecks === 0)).toBe(true)
  })
})
