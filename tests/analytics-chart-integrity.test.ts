import { describe, expect, it } from 'vitest'
import { buildSankeyLayout, groupSmallDonutSlices, type ChartSliceLike } from '../src/shared/chart-integrity.js'

const slice = (key: string, name: string, amountKopecks: number, color = '#13C97A'): ChartSliceLike => ({
  key,
  categoryId: crypto.randomUUID(),
  name,
  color,
  icon: null,
  amountKopecks,
  included: true,
})

describe('достоверность графиков аналитики', () => {
  it('сохраняет точные пропорции donut и объединяет мелкие категории', () => {
    const source = [slice('large', 'Основное', 9_750), slice('small-a', 'Мелочь A', 100), slice('small-b', 'Мелочь B', 150)]
    const plotted = groupSmallDonutSlices(source)

    expect(plotted).toHaveLength(2)
    expect(plotted.find((item) => item.name === 'Остальное')?.amountKopecks).toBe(250)
    expect(plotted.reduce((sum, item) => sum + item.amountKopecks, 0)).toBe(10_000)
    expect(source.map((item) => item.name)).toEqual(['Основное', 'Мелочь A', 'Мелочь B'])
  })

  it('показывает расходы без дохода и удерживает геометрию Sankey внутри viewBox', () => {
    const layout = buildSankeyLayout([], [slice('expense', 'Расход', 10_000, '#EF5B0A')], 0, 10_000)

    expect(layout.sourceBands[0]?.item.name).toBe('Из остатка / дефицит')
    expect(layout.targetBands[0]?.item.name).toBe('Расход')
    expect(layout.sourceBands[0]?.height).toBe(300)
    expect(layout.targetBands[0]?.height).toBe(300)
    expect(layout.flowHeight).toBeLessThanOrEqual(300)
  })
})
