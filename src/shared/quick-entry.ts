import type { CategoryView, TransactionView } from './contracts.js'

/** What the shortcut sends and what we made of it. */
export type QuickEntry = {
  amountKopecks: number
  note: string
  categoryId: string | null
  /** True when the category came from matching rather than an explicit choice. */
  categoryGuessed: boolean
}

const normalise = (value: string) => value
  .toLocaleLowerCase('ru')
  .replaceAll('ё', 'е')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * Levenshtein distance, capped: anything past the limit is not a near-miss and the
 * exact value stops mattering.
 */
function distance(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    let best = i
    for (let j = 1; j <= right.length; j += 1) {
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
      current.push(value)
      if (value < best) best = value
    }
    if (best > limit) return limit + 1
    previous = current
  }
  return previous[right.length] ?? limit + 1
}

/**
 * A typo should still land, but a different word never should: one edit for short
 * names, two for long ones, and nothing below four characters is fuzzy-matched at
 * all - "дом" and "дым" are different categories, not a slip.
 */
function near(typed: string, name: string) {
  if (typed.length < 4) return false
  const limit = name.length > 8 ? 2 : 1
  return distance(typed, name, limit) <= limit
}

/**
 * Works out which category a line of text from the shortcut means.
 *
 * The text doubles as the note and the category hint, so nothing extra has to be
 * typed. Tried in order: the whole line as a category name, the first word as one,
 * then the same line as a note used before - after a few weeks of writing "стики"
 * that history is a better signal than any name matching.
 *
 * Anything unmatched is left uncategorised on purpose. Inventing a category from a
 * typo would quietly fill the list with near-duplicates.
 */
export function resolveQuickEntry(
  text: string,
  amountKopecks: number,
  categories: CategoryView[],
  history: ReadonlyArray<Pick<TransactionView, 'note' | 'categoryId' | 'type'>>,
): QuickEntry {
  const raw = text.trim()
  const whole = normalise(raw)
  const usable = categories.filter((item) => item.type === 'expense' && !item.archivedAt)
  const named = usable.map((item) => ({ item, name: normalise(item.name) }))

  // An amount without a description has no categorisation signal. In particular,
  // it must not match an older transaction whose note also happened to be empty.
  if (!whole) return { amountKopecks, note: '', categoryId: null, categoryGuessed: false }

  const exact = named.find((entry) => entry.name === whole)
    ?? named.find((entry) => near(whole, entry.name))
  if (exact) return { amountKopecks, note: raw, categoryId: exact.item.id, categoryGuessed: true }

  const words = whole.split(' ')
  const head = words[0] ?? ''
  if (head && words.length > 1) {
    const byHead = named.find((entry) => entry.name === head)
      ?? named.find((entry) => entry.name.split(' ')[0] === head)
      ?? named.find((entry) => near(head, entry.name))
    if (byHead) {
      const note = raw.slice(raw.toLocaleLowerCase('ru').indexOf(head) + head.length).trim()
      return { amountKopecks, note: note || raw, categoryId: byHead.item.id, categoryGuessed: true }
    }
  }

  // What this note meant last time. Only expenses, and only categories that still exist.
  const known = new Set(usable.map((item) => item.id))
  const remembered = history.find((item) => item.type === 'expense'
    && item.categoryId
    && known.has(item.categoryId)
    && normalise(item.note) === whole)
  if (remembered) return { amountKopecks, note: raw, categoryId: remembered.categoryId, categoryGuessed: true }

  return { amountKopecks, note: raw, categoryId: null, categoryGuessed: false }
}

/** Amounts arrive as free text from a number field: "1 250,50", "80", "12.5". */
export function parseQuickAmount(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null
  const cleaned = value.replace(/\s| /g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const amount = Math.round(Number(cleaned) * 100)
  return amount > 0 ? amount : null
}

const NUMBER = String.raw`\d[\d\s ]*(?:[.,]\d{1,2})?`

/**
 * One free-text field is the shortest shortcut a person can build by hand, so the
 * amount and the note arrive glued together: "1250 такси", "такси 300".
 */
export function splitQuickInput(raw: string): { amount: string; text: string } | null {
  const value = raw.trim()
  const leading = new RegExp(String.raw`^(${NUMBER})\s*(.*)$`).exec(value)
  if (leading) return { amount: leading[1]!.trim(), text: leading[2]!.trim() }
  const trailing = new RegExp(String.raw`^(.*?)\s+(${NUMBER})$`).exec(value)
  if (trailing) return { amount: trailing[2]!.trim(), text: trailing[1]!.trim() }
  return null
}
