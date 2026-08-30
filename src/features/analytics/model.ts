import type { DashboardSummary, TransactionType } from '../../shared/contracts'

export type ChartKind = 'donut' | 'line' | 'bars' | 'sankey'
export type AnalyticsType = Extract<TransactionType, 'income' | 'expense'>

export const CHART_KINDS: { kind: ChartKind; label: string }[] = [
  { kind: 'donut', label: 'Круговая' },
  { kind: 'line', label: 'Линейный' },
  { kind: 'bars', label: 'Столбчатая' },
  { kind: 'sankey', label: 'Санкей' },
]

export type Slice = {
  key: string
  categoryId: string | null
  name: string
  color: string
  icon: string | null
  amountKopecks: number
  included: boolean
}

/** Stable identity for a category row - "no category" has no id of its own. */
export const sliceKey = (type: AnalyticsType, categoryId: string | null) => `${type}:${categoryId ?? ''}`

/**
 * The rows for one direction, largest first, with the exclusions applied. The total
 * counts only what is still included, which is what the reference recomputes as the
 * check-buttons are toggled.
 */
export function buildSlices(summary: DashboardSummary, type: AnalyticsType, excluded: ReadonlySet<string>) {
  const slices: Slice[] = summary.byCategory
    .filter((item) => item.type === type)
    .map((item) => ({
      key: sliceKey(type, item.categoryId),
      categoryId: item.categoryId,
      name: item.name,
      color: item.color,
      icon: item.icon,
      amountKopecks: item.amountKopecks,
      included: !excluded.has(sliceKey(type, item.categoryId)),
    }))

  const visible = slices.filter((item) => item.included)
  const totalKopecks = visible.reduce((sum, item) => sum + item.amountKopecks, 0)
  const grandTotalKopecks = slices.reduce((sum, item) => sum + item.amountKopecks, 0)
  return { slices, visible, totalKopecks, grandTotalKopecks, allIncluded: visible.length === slices.length }
}
