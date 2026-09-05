import { MAX_AMOUNT_KOPECKS, type CategoryView, type TransactionView } from './contracts.js'
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

/** A word this workspace has explicitly assigned to a category. */
export type CategoryHints = ReadonlyMap<string, string>

/**
 * Normalises a line into the word a hint is keyed by: the first meaningful
 * word. Both writing a hint and looking one up go through this, so "Кофе"
 * typed today finds the rule saved for "кофе с собой" yesterday.
 */
export function hintKeyword(text: string): string | null {
  const first = normalise(text).split(' ')[0] ?? ''
  return first.length >= 3 ? first : null
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
  hints: CategoryHints = new Map(),
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

  // An explicit correction outranks everything below it, including a category
  // name that happens to look similar: this person already said what they meant.
  const known = new Set(usable.map((item) => item.id))
  const keyword = hintKeyword(raw)
  const hinted = keyword ? hints.get(keyword) : undefined
  if (hinted && known.has(hinted)) return guessed(hinted, raw)

  const remembered = fromHistory(whole, head, history, known)
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
  const kopecks = typeof value === 'number'
    ? (Number.isFinite(value) ? Math.round(value * 100) : null)
    : parseWrittenAmount(value)
  if (kopecks === null || !Number.isSafeInteger(kopecks)) return null
  // The ceiling every other channel enforces. Without it quick entry accepted
  // a billion roubles that the manual editor refuses.
  return kopecks > 0 && kopecks <= MAX_AMOUNT_KOPECKS ? kopecks : null
}

function parseWrittenAmount(value: string) {
  const cleaned = value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

/**
 * Why a line could not be turned into an expense. Each reason names something
 * the person can act on, because the alternative — guessing — is how
 * "1.234,56 продукты" quietly became 1,23 ₽.
 */
export type QuickRejection =
  | 'no-amount'
  | 'several-amounts'
  | 'grouping'
  | 'arithmetic'
  | 'shorthand'
  | 'income'

export type QuickLine =
  | { status: 'ok'; amount: string; text: string }
  | { status: 'rejected'; reason: QuickRejection }

/** Digits, optionally grouped by spaces, with at most two decimals. */
const AMOUNT = String.raw`\d{1,3}(?:[\s  ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const AMOUNT_ONLY = new RegExp(String.raw`^(?:${AMOUNT})$`)
/** Any run of digits, however it is written — used to count what is in the line. */
/** A word made only of digits and their separators, e.g. "1250", "12.5", "3". */
const NUMERIC_WORD = /^\d+(?:[.,]\d+)?$/

/** Words that mean money coming in. Recording these as spending is worse than refusing. */
const INCOME_WORDS = new Set([
  'зарплата', 'зп', 'аванс', 'премия', 'доход', 'пенсия', 'стипендия', 'кэшбек', 'кешбек',
  'кэшбэк', 'вернули', 'возврат', 'подработка', 'дивиденды', 'проценты', 'выплата',
])

/**
 * Words that make a nearby number a time rather than a price: "встреча в 5
 * утра" is not five roubles. Only checked for a number sitting mid-sentence,
 * where the line reads as prose rather than as an entry.
 */
const CLOCK_WORDS = new Set([
  'утра', 'утром', 'вечера', 'вечером', 'дня', 'днем', 'ночи', 'ночью',
  'часов', 'часа', 'час', 'минут', 'минуты', 'мин', 'ч',
])

const normaliseWord = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Reads one free-text line as "amount + description", or explains why it cannot.
 *
 * The old rule took whatever numeric prefix it could and left the rest in the
 * note, so a thousands separator, an arithmetic expression or a "1к" shorthand
 * each produced a plausible-looking but wrong amount with no warning at all.
 * This one accepts a line only when exactly one token is a well-formed amount
 * and everything else is description.
 */
export function parseQuickLine(raw: string): QuickLine {
  const value = raw.trim()
  if (!value) return { status: 'rejected', reason: 'no-amount' }

  const words = value.split(/[\s  ]+/)
  if (words.some((word) => INCOME_WORDS.has(normaliseWord(word)) || word.startsWith('+'))) {
    return { status: 'rejected', reason: 'income' }
  }
  if (/\d[+\-*/x×]\d|\d\s*[+*/×]\s*\d/.test(value)) return { status: 'rejected', reason: 'arithmetic' }
  // "1к", "5 тыс", "300р" — shorthands and currency suffixes this grammar
  // refuses to invent a value for. The word boundary is spelled out because
  // \b is defined on Latin word characters and never fires after "к".
  if (/\d[\s  ]*(?:кк|к|k|тыс|т|млн|м|руб|р|₽|\$|€)(?![\p{L}\d])/iu.test(value)) {
    return { status: 'rejected', reason: 'shorthand' }
  }

  // A grouped amount is written with spaces, so "3 200 продукты" is one amount
  // spread over two words. Rebuild it before counting how many numbers there are.
  const grouped = groupedAmount(words)
  if (grouped) return { status: 'ok', amount: grouped.amount, text: grouped.text }

  const numeric = words.filter((word) => NUMERIC_WORD.test(word))
  // Two separate numbers in one line have no obvious reading: "такси 1 2" is
  // not 12 ₽, and it is not 2 ₽ either. Ask rather than pick one.
  if (numeric.length > 1) return { status: 'rejected', reason: 'several-amounts' }

  if (numeric.length === 1 && AMOUNT_ONLY.test(numeric[0]!)) {
    const amount = numeric[0]!
    const at = words.indexOf(amount)
    const midSentence = at > 0 && at < words.length - 1
    // The number may sit mid-sentence — "Потратил 300 на кофе" — and with only
    // one number present there is nothing ambiguous about taking it. Unless the
    // next word turns it into a clock reading.
    if (midSentence && CLOCK_WORDS.has(normaliseWord(words[at + 1]!))) {
      return { status: 'rejected', reason: 'no-amount' }
    }
    return { status: 'ok', amount, text: [...words.slice(0, at), ...words.slice(at + 1)].join(' ') }
  }

  if (!/\d/.test(value)) return { status: 'rejected', reason: 'no-amount' }
  // Digits are present but no word is a clean amount: they are glued to
  // something, like the thousands separator in "1.234,56".
  return { status: 'rejected', reason: /\d[.,]\d{3}/.test(value) ? 'grouping' : 'no-amount' }
}

/**
 * "3 200 продукты" and "продукты 3 200": digits split across words by the
 * thousands separator people actually type.
 */
function groupedAmount(words: string[]) {
  const runFrom = (index: number, step: 1 | -1) => {
    const parts: string[] = []
    for (let i = index; i >= 0 && i < words.length; i += step) {
      if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(words[i]!)) break
      parts.push(words[i]!)
    }
    return step === 1 ? parts : parts.reverse()
  }
  const head = runFrom(0, 1)
  if (head.length > 1 && head.length < words.length && AMOUNT_ONLY.test(head.join(' '))) {
    return { amount: head.join(' '), text: words.slice(head.length).join(' ') }
  }
  const tail = runFrom(words.length - 1, -1)
  if (tail.length > 1 && tail.length < words.length && AMOUNT_ONLY.test(tail.join(' '))) {
    return { amount: tail.join(' '), text: words.slice(0, words.length - tail.length).join(' ') }
  }
  return null
}

/**
 * Kept for the two-field shortcut, which sends the amount separately and has
 * no line to parse. New callers use `parseQuickLine`.
 */
export function splitQuickInput(raw: string): { amount: string; text: string } | null {
  const parsed = parseQuickLine(raw)
  return parsed.status === 'ok' ? { amount: parsed.amount, text: parsed.text } : null
}
