import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, XAxis, YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { tint } from '../lib/palette'
import type { ChartKind, Slice } from '../features/analytics/model'
import { useReducedMotion } from '../features/motion/useReducedMotion'
import { CHART_TYPE, UI_COLORS } from '../shared/design-tokens'

const money = (kopecks: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(kopecks / 100)} ₽`
const short = (kopecks: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(kopecks / 100)

export type TrendPoint = { date: string; incomeKopecks: number; expenseKopecks: number }

/**
 * All four analytics charts behind one lazy chunk, so switching type never pulls a
 * second copy of recharts and the header above them is never remounted.
 */
export default function AnalyticsChart(props: {
  kind: ChartKind
  slices: Slice[]
  incomeSlices: Slice[]
  expenseSlices: Slice[]
  totalKopecks: number
  trend: TrendPoint[]
  granularity: 'day' | 'month'
  tone: 'income' | 'expense'
  incomeKopecks: number
  expenseKopecks: number
}) {
  const reducedMotion = useReducedMotion()
  if (props.kind === 'donut') return <Donut slices={props.slices} totalKopecks={props.totalKopecks} animate={!reducedMotion} />
  if (props.kind === 'line') return <Trend {...props} animate={!reducedMotion} />
  if (props.kind === 'bars') return <Bars {...props} animate={!reducedMotion} />
  return <Sankey {...props} />
}

/**
 * The reference draws each segment twice: a saturated arc on the outer edge and a
 * tinted body filling the ring, separated by hairline white gaps.
 */
function Donut({ slices, totalKopecks, animate }: { slices: Slice[]; totalKopecks: number; animate: boolean }) {
  // A category worth half a percent is two degrees of arc, which renders as a torn
  // hairline rather than a segment. Give every slice a legible floor and take the
  // difference proportionally from the rest; the centre total and the list below
  // keep the real amounts, so nothing the user reads as a number is distorted.
  const MIN_SHARE = 0.02
  const total = slices.reduce((sum, item) => sum + item.amountKopecks, 0)
  const plotted = (() => {
    if (!total) return slices.map((item) => ({ ...item, plot: 1 }))
    const floor = total * MIN_SHARE
    const small = slices.filter((item) => item.amountKopecks < floor)
    if (!small.length) return slices.map((item) => ({ ...item, plot: item.amountKopecks }))
    const lifted = small.length * floor
    const rest = total - small.reduce((sum, item) => sum + item.amountKopecks, 0)
    const scale = rest > 0 ? Math.max(0, total - lifted) / rest : 0
    return slices.map((item) => ({
      ...item,
      plot: item.amountKopecks < floor ? floor : item.amountKopecks * scale,
    }))
  })()

  return <div className="analytics-donut">
    <ResponsiveContainer width="100%" height={380}>
      <PieChart>
        <Pie data={plotted} dataKey="plot" startAngle={90} endAngle={-270} innerRadius="56%" outerRadius="96%" paddingAngle={1.4} cornerRadius={6} stroke={UI_COLORS.surface} strokeWidth={3} isAnimationActive={animate} animationDuration={440} animationEasing="ease-out">
          {plotted.map((item) => <Cell key={item.key} fill={tint(item.color)} />)}
        </Pie>
        <Pie data={plotted} dataKey="plot" startAngle={90} endAngle={-270} innerRadius="91%" outerRadius="96%" paddingAngle={1.4} cornerRadius={3} stroke="none" isAnimationActive={animate} animationDuration={440} animationEasing="ease-out">
          {plotted.map((item) => <Cell key={item.key} fill={item.color} />)}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    <div className="analytics-donut-center"><small>Итого</small><strong>{money(totalKopecks)}</strong></div>
  </div>
}

const bucketLabel = (date: string, granularity: 'day' | 'month') => granularity === 'month'
  ? format(parseISO(`${date}-01`), 'LLL', { locale: ru })
  : String(Number(date.slice(8, 10)))

/** Spend or income per bucket with the period's average drawn across it. */
function Trend({ trend, granularity, tone, animate }: { trend: TrendPoint[]; granularity: 'day' | 'month'; tone: 'income' | 'expense'; animate: boolean }) {
  const colour = tone === 'income' ? UI_COLORS.income : UI_COLORS.expense
  const data = trend.map((item) => ({
    label: bucketLabel(item.date, granularity),
    value: (tone === 'income' ? item.incomeKopecks : item.expenseKopecks) / 100,
  }))
  const average = data.length ? data.reduce((sum, item) => sum + item.value, 0) / data.length : 0
  const averageLabel = granularity === 'month' ? 'Сред. за месяц' : 'Сред. за день'

  return <ResponsiveContainer width="100%" height={230}>
    <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity=".26" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={UI_COLORS.chartGrid} strokeDasharray="4 5" vertical={false} />
      <XAxis dataKey="label" axisLine={{ stroke: UI_COLORS.chartAxis, strokeWidth: 2.4 }} tickLine={false} tick={{ fill: UI_COLORS.chartMuted, fontSize: CHART_TYPE.label }} interval="preserveStartEnd" minTickGap={14} />
      <YAxis width={52} axisLine={false} tickLine={false} tick={{ fill: UI_COLORS.chartTick, fontSize: CHART_TYPE.label, dy: -5 }} tickFormatter={(value) => new Intl.NumberFormat('ru-RU').format(Number(value))} />
      <Area type="monotone" dataKey="value" stroke="none" fill="url(#trend-fill)" isAnimationActive={animate} animationDuration={420} animationEasing="ease-out" />
      <Line type="monotone" dataKey="value" stroke={colour} strokeWidth={2.4} dot={false} isAnimationActive={animate} animationDuration={440} animationEasing="ease-out" />
      {average > 0 && <ReferenceLine y={average} stroke={colour} strokeDasharray="5 5" strokeOpacity=".7"
        label={{ value: `${averageLabel} ${short(Math.round(average * 100))}`, position: 'insideBottomRight', fill: colour, fontSize: CHART_TYPE.label }} />}
    </ComposedChart>
  </ResponsiveContainer>
}

/** One bar per category, so the ranking that the list shows is also readable at a glance. */
function Bars({ slices, animate }: { slices: Slice[]; animate: boolean }) {
  const data = slices.map((item) => ({ name: item.name, value: item.amountKopecks / 100, color: item.color }))
  return <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 30)}>
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 46, bottom: 4, left: 0 }}>
      <XAxis type="number" hide />
      <YAxis type="category" dataKey="name" width={104} axisLine={false} tickLine={false} tick={{ fill: UI_COLORS.muted, fontSize: CHART_TYPE.category }} />
      <Bar dataKey="value" radius={7} barSize={19} isAnimationActive={animate} animationDuration={420} animationEasing="ease-out"
        label={{ position: 'right', fill: UI_COLORS.muted, fontSize: CHART_TYPE.value, formatter: (value: unknown) => short(Number(value) * 100) }}>
        {data.map((item) => <Cell key={item.name} fill={item.color} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
}

/**
 * Income on the left, the wallet in the middle, expenses and whatever is left over
 * on the right. Drawn by hand: the three-column shape is a handful of cubic bands,
 * and a generic Sankey layout would fight the reference rather than match it.
 */
function Sankey({ incomeSlices, expenseSlices, incomeKopecks, expenseKopecks }: {
  incomeSlices: Slice[]; expenseSlices: Slice[]; incomeKopecks: number; expenseKopecks: number
}) {
  const W = 380
  const H = 300
  const barW = 9
  const leftX = 26
  const midX = W / 2 - barW / 2
  const rightX = W - 26 - barW
  const gap = 3

  const incomes = incomeSlices.filter((item) => item.amountKopecks > 0)
  const total = Math.max(1, incomeKopecks)
  const surplus = Math.max(0, incomeKopecks - expenseKopecks)

  // Everything is scaled against total income, so band heights add up to the bar.
  const scale = (kopecks: number) => (kopecks / total) * (H - gap * 4)
  /** Lays a list out top to bottom, returning each item with its y and height. */
  const stack = <T,>(items: T[], amountOf: (item: T) => number) =>
    items.reduce<{ bands: { item: T; y: number; height: number }[]; next: number }>((state, item) => {
      const height = scale(amountOf(item))
      state.bands.push({ item, y: state.next, height })
      return { bands: state.bands, next: state.next + height + gap }
    }, { bands: [], next: 0 })

  const sources = stack(incomes, (item) => item.amountKopecks)
  const sourceHeight = Math.max(1, sources.next - gap)

  const outgoing = [
    ...expenseSlices.filter((item) => item.amountKopecks > 0).map((item) => ({ name: item.name, color: item.color, amount: item.amountKopecks })),
    ...(surplus > 0 ? [{ name: 'Профицит', color: UI_COLORS.chartSurplus, amount: surplus }] : []),
  ]
  const targets = stack(outgoing, (item) => item.amount)

  const band = (x1: number, y1: number, x2: number, y2: number, height: number) => {
    const cx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2} L ${x2} ${y2 + height} C ${cx} ${y2 + height} ${cx} ${y1 + height} ${x1} ${y1 + height} Z`
  }

  if (!sources.bands.length && !targets.bands.length) return null

  return <svg className="analytics-sankey" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Потоки доходов и расходов">
    {sources.bands.map((source) => <path key={source.item.key} d={band(leftX + barW, source.y, midX, source.y, source.height)} fill={tint(source.item.color)} opacity=".85" />)}
    {targets.bands.map((target) => <path key={target.item.name} d={band(midX + barW, target.y, rightX, target.y, target.height)} fill={tint(target.item.color)} opacity=".85" />)}
    {sources.bands.map((source) => <rect key={source.item.key} x={leftX} y={source.y} width={barW} height={source.height} rx={3} fill={source.item.color} />)}
    <rect x={midX} y={0} width={barW} height={sourceHeight} rx={3} fill={UI_COLORS.chartFlow} />
    {targets.bands.map((target) => <rect key={target.item.name} x={rightX} y={target.y} width={barW} height={target.height} rx={3} fill={target.item.color} />)}
  </svg>
}
