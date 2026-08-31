/** Data colours persist in PostgreSQL; keep their canonical values out of UI code. */
export const DATA_COLORS = {
  accountDefault: '#32D583',
  categoryFallback: '#6B706C',
  glyphFallback: '#6B6B6B',
  tileFallback: '#DBDBDB',
  categoryEditorDefault: '#F59E0B',
} as const

export const CATEGORY_PICKER_COLORS = [
  '#111111', '#EA082E', '#F1691E', '#F59E0B', '#EAB308', '#84CC16',
  '#07E240', '#10B981', '#14B8A6', '#10AAF2', '#2971F9', '#8034F8', '#E40F8D',
] as const

/** CSS custom properties are the runtime contract shared by SVG charts and CSS. */
export const UI_COLORS = {
  ink: 'var(--ink)',
  muted: 'var(--muted)',
  surface: 'var(--surface)',
  panel: 'var(--panel)',
  income: 'var(--income)',
  expense: 'var(--expense-chart)',
  chartInk: 'var(--chart-ink)',
  chartMuted: 'var(--chart-muted)',
  chartGrid: 'var(--chart-grid)',
  chartAxis: 'var(--chart-axis)',
  chartTick: 'var(--chart-tick)',
  chartCursor: 'var(--chart-cursor)',
  chartReference: 'var(--chart-reference)',
  chartSurplus: 'var(--chart-surplus)',
  chartFlow: 'var(--chart-flow)',
} as const

/** Recharts accepts numeric SVG text metrics rather than CSS custom properties. */
export const CHART_TYPE = { label: 9, value: 10, category: 10.5, regular: 400, bold: 700 } as const
