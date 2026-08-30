import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useReducedMotion } from '../features/motion/useReducedMotion'
import { CHART_TYPE, UI_COLORS } from '../shared/design-tokens'

const money = (kopecks: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(kopecks / 100)} ₽`

type TrendPoint = { day: number; expense: number | null; forecast: number | null }

/**
 * The month chart plus the reference's scrubber. Dragging across it moves a hairline
 * with a dot on each series, bolds the day under the finger and rewrites the legend
 * underneath - there is no floating tooltip in the original.
 *
 * It owns the scrub state so a drag repaints the chart alone; hoisting it would
 * re-render all nine insight tiles on every touchmove.
 */
export default function InsightsChart({ trend, daysInMonth, cutoffDay, maximum, ticks, totalKopecks }: {
  trend: TrendPoint[]; daysInMonth: number; cutoffDay: number; maximum: number; ticks: number[]; totalKopecks: number
}) {
  const reducedMotion = useReducedMotion()
  const [active, setActive] = useState<number | null>(null)
  const point = active === null ? null : trend[active]
  const activeDay = point?.day ?? null
  const scrubbed = point ? Math.round((point.expense ?? point.forecast ?? 0) * 100) : totalKopecks

  // The gutter has to fit the widest label, or a year's totals get clipped.
  const axisWidth = 12 + 5.4 * new Intl.NumberFormat('ru-RU').format(ticks[ticks.length - 1] ?? 0).length
  const dayTicks = useMemo(
    () => Array.from({ length: Math.ceil(daysInMonth / 2) }, (_, index) => index * 2 + 1),
    [daysInMonth],
  )
  // Recharts hands ticks a plain object, so the active day is bolded by rendering
  // the label ourselves rather than through the `tick` style shorthand.
  const renderTick = (props: { x?: string | number; y?: string | number; payload?: { value?: unknown } }) => {
    const value = Number(props.payload?.value)
    const on = value === activeDay
    return <text x={Number(props.x)} y={Number(props.y) + 8} textAnchor="middle" fill={on ? UI_COLORS.chartInk : UI_COLORS.chartMuted} fontSize={CHART_TYPE.label} fontWeight={on ? CHART_TYPE.bold : CHART_TYPE.regular}>{value}</text>
  }
  const track = (state: { activeTooltipIndex?: number | string | null }) => {
    const next = Number(state?.activeTooltipIndex)
    setActive(Number.isInteger(next) ? next : null)
  }

  return <section className="insights-chart">
    <ResponsiveContainer width="100%" height={148}>
      <ComposedChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onMouseMove={track} onTouchMove={track} onMouseLeave={() => setActive(null)}>
        <defs>
          <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={UI_COLORS.expense} stopOpacity=".28" />
            <stop offset="1" stopColor={UI_COLORS.expense} stopOpacity="0" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={UI_COLORS.chartGrid} strokeDasharray="4 5" vertical={false} />
        <XAxis dataKey="day" ticks={dayTicks} axisLine={{ stroke: UI_COLORS.chartAxis, strokeWidth: 2.4 }} tickLine={false} tick={renderTick} interval={0} />
        {/* The reference omits the zero label and sits each one just above its line. */}
        <YAxis width={axisWidth} domain={[0, maximum]} ticks={ticks.slice(1)} axisLine={false} tickLine={false} tick={{ fill: UI_COLORS.chartTick, fontSize: CHART_TYPE.label, dy: -5 }} tickFormatter={(value) => new Intl.NumberFormat('ru-RU').format(Number(value))} />
        <Tooltip content={() => null} cursor={{ stroke: UI_COLORS.chartCursor, strokeWidth: 1 }} />
        {active === null && <ReferenceLine x={cutoffDay} stroke={UI_COLORS.chartReference} />}
        <Area type="monotone" dataKey="expense" stroke="none" fill="url(#spend-fill)" connectNulls={false} activeDot={false} isAnimationActive={!reducedMotion} animationBegin={90} animationDuration={380} animationEasing="ease-out" />
        <Line type="monotone" dataKey="expense" stroke={UI_COLORS.expense} strokeWidth={2.6} dot={false} connectNulls={false} activeDot={{ r: 6, fill: UI_COLORS.expense, stroke: 'none' }} isAnimationActive={!reducedMotion} animationDuration={440} animationEasing="ease-out" />
        <Line type="monotone" dataKey="forecast" stroke={UI_COLORS.expense} strokeWidth={2.6} strokeDasharray="7 6" dot={false} connectNulls={false} activeDot={false} isAnimationActive={!reducedMotion} animationBegin={150} animationDuration={320} animationEasing="ease-out" />
      </ComposedChart>
    </ResponsiveContainer>
    <div className="chart-legend"><span className="now">— {money(scrubbed)}</span><span className="was" hidden /><span className="plan">·· {money(totalKopecks)}</span></div>
  </section>
}
