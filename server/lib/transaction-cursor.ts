import { AppError } from './errors.js'

export type TransactionCursor = { occurredAt: string; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function encodeTransactionCursor(value: TransactionCursor) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeTransactionCursor(value?: string): TransactionCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TransactionCursor>
    if (typeof decoded.occurredAt !== 'string' || Number.isNaN(new Date(decoded.occurredAt).getTime()) || typeof decoded.id !== 'string' || !UUID.test(decoded.id)) throw new Error('bad cursor')
    return { occurredAt: new Date(decoded.occurredAt).toISOString(), id: decoded.id }
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Некорректный cursor операций')
  }
}
