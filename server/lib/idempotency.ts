import type { TransactionInput } from '../store/types.js'
import { hashPayload } from './security.js'

/** Hashes the money-changing meaning, normalising equivalent optional fields. */
export function transactionRequestHash(input: TransactionInput) {
  return hashPayload({
    workspaceId: input.workspaceId,
    type: input.type,
    amountKopecks: input.amountKopecks,
    accountId: input.accountId,
    targetAccountId: input.targetAccountId || null,
    categoryId: input.categoryId || null,
    occurredAt: input.occurredAt,
    note: input.note,
    source: input.source,
  })
}
