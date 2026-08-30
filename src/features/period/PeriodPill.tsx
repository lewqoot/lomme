import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { MenuItem } from '../../components/AnchoredMenu'
import { useAnchoredMenu } from '../../components/useAnchoredMenu'
import { haptics } from '../../lib/telegram'
import {
  canGoBack, canGoForward, PERIOD_PRESETS, resolvePeriod, shiftPeriod,
  type PeriodMode, type PeriodSelection,
} from './model'

/**
 * The period control from the reference: arrows either side of a frosted pill, and
 * a tap on the label opens a menu of presets marked with a leading check, ending
 * with a custom-range row.
 */
export function PeriodPill({ value, onChange, tone = 'default' }: {
  value: PeriodSelection
  onChange(next: PeriodSelection): void
  tone?: 'default' | 'frost'
}) {
  const [custom, setCustom] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const menu = useAnchoredMenu(anchor)
  const previousLabel = useRef('')
  const [leavingLabel, setLeavingLabel] = useState('')
  const [direction, setDirection] = useState<-1 | 0 | 1>(0)
  const now = new Date()
  const period = resolvePeriod(value, now)

  useEffect(() => {
    if (!previousLabel.current) { previousLabel.current = period.label; return }
    if (previousLabel.current === period.label) return
    setLeavingLabel(previousLabel.current)
    previousLabel.current = period.label
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setLeavingLabel(''), reduced ? 120 : 220)
    return () => window.clearTimeout(timer)
  }, [period.label])

  const dismiss = () => { menu.close(); setCustom(false) }
  const step = (nextDirection: -1 | 1) => { haptics.selection(); setDirection(nextDirection); onChange(shiftPeriod(value, nextDirection)) }
  const pick = (mode: PeriodMode) => {
    haptics.selection()
    setDirection(0)
    dismiss()
    // Presets re-anchor on today, otherwise switching from an old month would land
    // on a window the user never asked for.
    onChange({ mode, anchor: new Date().toISOString() })
  }

  return <div className={`period-pill${tone === 'frost' ? ' frost' : ''}`} ref={anchor}>
    <button type="button" aria-label="Предыдущий период" disabled={!canGoBack(value)} onClick={() => step(-1)}><ChevronLeft /></button>
    <button type="button" className="period-label" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => { haptics.selection(); menu.toggle() }}>
      <span className={`period-label-current ${direction < 0 ? 'previous' : direction > 0 ? 'next' : ''}`} key={period.label}>{period.label}</span>
      {leavingLabel && <span className={`period-label-leaving ${direction < 0 ? 'previous' : direction > 0 ? 'next' : ''}`} aria-hidden="true">{leavingLabel}</span>}
    </button>
    <button type="button" aria-label="Следующий период" disabled={!canGoForward(value, now)} onClick={() => step(1)}><ChevronRight /></button>

    {menu.render(<>
      {PERIOD_PRESETS.map((preset) => <MenuItem key={preset.mode} checked={value.mode === preset.mode} onSelect={() => pick(preset.mode)}>{preset.label}</MenuItem>)}
      <span className="period-menu-label">Пользовательский</span>
      {custom
        ? <CustomRange value={value} onSubmit={(next) => { dismiss(); onChange(next) }} />
        : <button type="button" className="period-menu-add" onClick={() => setCustom(true)}><Plus />Добавить</button>}
    </>)}
  </div>
}
function CustomRange({ value, onSubmit }: { value: PeriodSelection; onSubmit(next: PeriodSelection): void }) {
  const current = resolvePeriod(value)
  const [start, setStart] = useState(format(current.start, 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(current.end, 'yyyy-MM-dd'))
  const valid = start <= end

  return <form
    className="period-custom"
    onSubmit={(event) => {
      event.preventDefault()
      if (!valid) return
      haptics.notify('success')
      onSubmit({ mode: 'custom', anchor: new Date(start).toISOString(), start: new Date(start).toISOString(), end: new Date(end).toISOString() })
    }}
  >
    <label>С<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
    <label>По<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>
    <button type="submit" disabled={!valid}>Применить</button>
  </form>
}
