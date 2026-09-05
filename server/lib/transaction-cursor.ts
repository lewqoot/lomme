import { AppError } from './errors.js'

export type TransactionCursor = { occurredAt: string; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/

export function encodeTransactionCursor(value: TransactionCursor) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeTransactionCursor(value?: string): TransactionCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TransactionCursor>
    if (typeof decoded.occurredAt !== 'string' || !UTC_TIMESTAMP.test(decoded.occurredAt) || Number.isNaN(new Date(decoded.occurredAt).getTime()) || typeof decoded.id !== 'string' || !UUID.test(decoded.id)) throw new Error('bad cursor')
    // PostgreSQL keeps six fractional digits while JavaScript Date keeps only
    // three. Preserve the database sort key verbatim or the next page can skip
    // rows that fall inside the same millisecond.
    return { occurredAt: decoded.occurredAt, id: decoded.id }
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Некорректный cursor операций')
  }
}
