import { DATA_COLORS, UI_COLORS } from './design-tokens.js'

export type ChartSliceLike = {
  key: string
  categoryId: string | null
  name: string
  color: string
  icon: string | null
  amountKopecks: number
  included: boolean
}

/**
 * Keep the chart numerically honest. Several tiny categories are easier to see
 * as one exact "Остальное" arc; the unchanged list below the chart remains the
 * disclosure of every category included in that arc.
 */
export function groupSmallDonutSlices<T extends ChartSliceLike>(slices: T[], minimumShare = 0.02): ChartSliceLike[] {
  const total = slices.reduce((sum, item) => sum + item.amountKopecks, 0)
  if (!total) return slices
  const small = slices.filter((item) => item.amountKopecks / total < minimumShare)
  if (small.length < 2) return slices
  const smallKeys = new Set(small.map((item) => item.key))
  return [
    ...slices.filter((item) => !smallKeys.has(item.key)),
    {
      key: 'donut:other',
      categoryId: null,
      name: 'Остальное',
      color: DATA_COLORS.categoryFallback,
      icon: null,
      amountKopecks: small.reduce((sum, item) => sum + item.amountKopecks, 0),
      included: true,
    },
  ]
}

export type SankeyFlow = { key: string; name: string; color: string; amount: number; synthetic: boolean }
export type SankeyBand = { item: SankeyFlow; y: number; height: number }

/** Equalises both sides of a flow and keeps every band inside the viewBox. */
export function buildSankeyLayout(
  incomeSlices: ChartSliceLike[],
  expenseSlices: ChartSliceLike[],
  incomeKopecks: number,
  expenseKopecks: number,
  height = 300,
  requestedGap = 3,
) {
  const total = Math.max(incomeKopecks, expenseKopecks)
  if (!total) return { sourceBands: [] as SankeyBand[], targetBands: [] as SankeyBand[], flowHeight: 0 }
  const deficit = Math.max(0, expenseKopecks - incomeKopecks)
  const surplus = Math.max(0, incomeKopecks - expenseKopecks)
  const sources: SankeyFlow[] = [
    ...incomeSlices.filter((item) => item.amountKopecks > 0).map((item) => ({ key: item.key, name: item.name, color: item.color, amount: item.amountKopecks, synthetic: false })),
    ...(deficit > 0 ? [{ key: 'deficit', name: 'Из остатка / дефицит', color: UI_COLORS.chartSurplus, amount: deficit, synthetic: true }] : []),
  ]
  const targets: SankeyFlow[] = [
    ...expenseSlices.filter((item) => item.amountKopecks > 0).map((item) => ({ key: item.key, name: item.name, color: item.color, amount: item.amountKopecks, synthetic: false })),
    ...(surplus > 0 ? [{ key: 'surplus', name: 'Профицит', color: UI_COLORS.chartSurplus, amount: surplus, synthetic: true }] : []),
  ]
  const maxBands = Math.max(sources.length, targets.length, 1)
  const gap = Math.min(requestedGap, height / (maxBands * 4))
  const usableHeight = height - gap * (maxBands - 1)
  const stack = (items: SankeyFlow[]): SankeyBand[] => {
    let next = 0
    return items.map((item) => {
      const band = { item, y: next, height: (item.amount / total) * usableHeight }
      next += band.height + gap
      return band
    })
  }
  const sourceBands = stack(sources)
  const targetBands = stack(targets)
  const extent = (bands: SankeyBand[]) => bands.length ? bands.at(-1)!.y + bands.at(-1)!.height : 0
  return { sourceBands, targetBands, flowHeight: Math.max(1, extent(sourceBands), extent(targetBands)) }
}
