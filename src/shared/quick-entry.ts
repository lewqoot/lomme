import type { CategoryView, TransactionView } from './contracts.js'
import { MERCHANT_HINTS, MERCHANT_PHRASES } from './merchant-hints.js'

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

const STOP_WORDS = new Set(['и', 'в', 'на', 'с', 'со', 'для', 'по', 'от', 'до', 'за', 'из'])

/**
 * The words of a category name that can stand for the whole of it. "Кафе и
 * рестораны" is written as "кафе" far more often than in full, so each of its
 * real words has to be a way in. Joining words are dropped: matching on "и"
 * would put every third line into the first category that happens to have one.
 */
function nameTokens(name: string) {
  return name.split(' ').filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

type Named = { item: CategoryView; name: string; tokens: string[] }

/**
 * A guess is only made when exactly one category fits. Two candidates mean the
 * text is ambiguous, and silently picking the first one is how a category list
 * fills up with entries nobody put there.
 */
function onlyMatch(named: Named[], predicate: (entry: Named) => boolean): Named | null {
  const found = named.filter(predicate)
  return found.length === 1 ? found[0]! : null
}

/**
 * What this person meant last time. Matched on the whole note first and then on
 * its first word, so a category corrected once for "кофе с собой" also answers
 * a later plain "кофе".
 */
function fromHistory(
  whole: string,
  head: string,
  history: ReadonlyArray<Pick<TransactionView, 'note' | 'categoryId' | 'type'>>,
  known: Set<string>,
) {
  const usable = history.filter((item) => item.type === 'expense' && item.categoryId && known.has(item.categoryId))
  const exact = usable.find((item) => normalise(item.note) === whole)
  if (exact) return exact.categoryId
  if (head.length < 3) return null
  const byFirstWord = usable.find((item) => normalise(item.note).split(' ')[0] === head)
  return byFirstWord?.categoryId ?? null
}

/** Which default category a merchant name points at, phrases before words. */
function fromMerchants(whole: string, words: string[]) {
  const phrase = MERCHANT_PHRASES.find((candidate) => whole.includes(candidate))
  if (phrase) return MERCHANT_HINTS[phrase]!
  for (const word of words) {
    const hint = MERCHANT_HINTS[word]
    if (hint) return hint
  }
  return null
}

/**
 * Works out which category a line of text means, for the shortcut and the bot
 * alike.
 *
 * The text doubles as the note and the category hint, so nothing extra has to
 * be typed. Rules are tried in order and the first that fits wins: the person's
 * own history outranks the shared merchant dictionary, and both outrank a
 * typo-tolerant comparison, which is the guess most likely to be wrong.
 *
 * Anything unmatched is left uncategorised on purpose. Inventing a category
 * from a stray word would quietly fill the list with near-duplicates.
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
  const named: Named[] = usable.map((item) => {
    const name = normalise(item.name)
    return { item, name, tokens: nameTokens(name) }
  })

  // An amount without a description has no categorisation signal. In particular,
  // it must not match an older transaction whose note also happened to be empty.
  if (!whole) return { amountKopecks, note: '', categoryId: null, categoryGuessed: false }

  const words = whole.split(' ')
  const head = words[0] ?? ''
  const guessed = (categoryId: string, note: string): QuickEntry =>
    ({ amountKopecks, note, categoryId, categoryGuessed: true })

  const exact = named.find((entry) => entry.name === whole)
  if (exact) return guessed(exact.item.id, raw)

  const remembered = fromHistory(whole, head, history, new Set(usable.map((item) => item.id)))
  if (remembered) return guessed(remembered, raw)

  // A category name opening the line describes the rest of it: "Продукты на
  // неделю" is a food entry noted as "на неделю".
  if (words.length > 1) {
    const byHead = onlyMatch(named, (entry) => entry.name === head || entry.tokens.includes(head))
    if (byHead) {
      const note = raw.slice(raw.toLocaleLowerCase('ru').indexOf(head) + head.length).trim()
      return guessed(byHead.item.id, note || raw)
    }
  }

  // One word of a category name, standing for the whole name: "кафе".
  const byToken = onlyMatch(named, (entry) => entry.tokens.includes(whole)
    || words.some((word) => word.length >= 3 && entry.tokens.includes(word)))
  if (byToken) return guessed(byToken.item.id, raw)

  // A name typed only as far as it stays unambiguous: "продук", "жилищ".
  const byPrefix = whole.length >= 4
    ? onlyMatch(named, (entry) => entry.tokens.some((token) => token.length > whole.length && token.startsWith(whole)))
    : null
  if (byPrefix) return guessed(byPrefix.item.id, raw)

  const merchantName = fromMerchants(whole, words)
  if (merchantName) {
    const target = named.find((entry) => entry.name === normalise(merchantName))
    if (target) return guessed(target.item.id, raw)
  }

  const misspelt = named.find((entry) => near(whole, entry.name))
    ?? (words.length > 1 ? named.find((entry) => near(head, entry.name)) : undefined)
  if (misspelt) return guessed(misspelt.item.id, raw)

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
