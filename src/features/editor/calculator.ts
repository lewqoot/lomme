export type CalcOperator = '+' | '−' | '×' | '÷'
export type CalcKey = CalcOperator | '⌫' | ',' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

/**
 * The editor's keypad. The reference has no `=`: an operator folds whatever came
 * before it, and Save folds the last pending operation, so the number on screen is
 * always the current value.
 *
 * `entry` is what is displayed, kept as the literal string the user typed so the
 * trailing comma of "50," survives until the next digit. `fresh` marks a value that
 * was produced by folding rather than typed - the next digit replaces it instead of
 * appending.
 */
export type CalcState = { entry: string; pending: number | null; operator: CalcOperator | null; fresh: boolean }

export const initialCalc = (entry = '0'): CalcState => ({ entry, pending: null, operator: null, fresh: true })

const MAX_DIGITS = 11

/** Display string -> kopecks. Rounds half away from zero, like a cash register. */
export function toKopecks(entry: string): number {
  const normalised = entry.replace(',', '.')
  const value = Number(normalised)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

/** Kopecks -> display string, trimming the decimals when they are zero. */
export function fromKopecks(kopecks: number): string {
  const sign = kopecks < 0 ? '-' : ''
  const absolute = Math.abs(kopecks)
  const rubles = Math.floor(absolute / 100)
  const cents = absolute % 100
  return cents === 0 ? `${sign}${rubles}` : `${sign}${rubles},${String(cents).padStart(2, '0')}`
}

/**
 * Arithmetic runs in kopecks so addition and subtraction stay exact. Multiply and
 * divide use the ruble value - scaling by a factor genuinely produces fractions -
 * and round back to whole kopecks once.
 */
function fold(left: number, operator: CalcOperator, right: number): number {
  switch (operator) {
    case '+': return left + right
    case '−': return left - right
    case '×': return Math.round((left / 100) * (right / 100) * 100)
    case '÷': return right === 0 ? left : Math.round((left / right) * 100)
  }
}

export function pressKey(state: CalcState, key: CalcKey): CalcState {
  if (key === '+' || key === '−' || key === '×' || key === '÷') {
    const current = toKopecks(state.entry)
    // Tapping a second operator in a row only swaps it; nothing to fold yet.
    if (state.fresh && state.operator !== null && state.pending !== null) {
      return { ...state, operator: key }
    }
    const pending = state.pending !== null && state.operator ? fold(state.pending, state.operator, current) : current
    return { entry: fromKopecks(pending), pending, operator: key, fresh: true }
  }

  if (key === '⌫') {
    if (state.fresh) return { ...state, entry: '0', fresh: false }
    const next = state.entry.length > 1 ? state.entry.slice(0, -1) : '0'
    return { ...state, entry: next === '-' ? '0' : next, fresh: false }
  }

  if (key === ',') {
    if (state.fresh) return { ...state, entry: '0,', fresh: false }
    return state.entry.includes(',') ? state : { ...state, entry: `${state.entry},`, fresh: false }
  }

  if (state.fresh) return { ...state, entry: key, fresh: false }
  if (state.entry === '0') return { ...state, entry: key, fresh: false }
  // Two decimals is the most a kopeck amount can carry.
  const [, decimals] = state.entry.split(',')
  if (decimals !== undefined && decimals.length >= 2) return state
  if (state.entry.replace(/\D/g, '').length >= MAX_DIGITS) return state
  return { ...state, entry: state.entry + key, fresh: false }
}

/** The value Save should store: folds any operation still pending. */
export function resolveKopecks(state: CalcState): number {
  const current = toKopecks(state.entry)
  if (state.pending === null || state.operator === null || state.fresh) return current
  return fold(state.pending, state.operator, current)
}
