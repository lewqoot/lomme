import type { SnapshotRange } from '../lib/range.js'
import type { z } from 'zod'
import type {
  AppSnapshot,
  AccountInvitePreview,
  TransactionPage,
  authTelegramSchema,
  createAccountSchema,
  createCategorySchema,
  reorderCategoriesSchema,
  createTransactionSchema,
  quickEntrySchema,
  createWorkspaceSchema,
  updateCategorySchema,
  updateTransactionSchema,
  updateAccountSchema,
  activeAccountSchema,
} from '../../src/shared/contracts.js'
import type { TelegramIdentity } from '../auth/telegram.js'

export type AuthInput = z.infer<typeof authTelegramSchema>
export type TransactionInput = z.infer<typeof createTransactionSchema>
export type QuickEntryInput = z.infer<typeof quickEntrySchema>
export type TransactionUpdate = z.infer<typeof updateTransactionSchema>
export type AccountInput = z.infer<typeof createAccountSchema>
export type AccountUpdate = z.infer<typeof updateAccountSchema>
export type ActiveAccountInput = z.infer<typeof activeAccountSchema>
export type CategoryInput = z.infer<typeof createCategorySchema>
export type CategoryUpdate = z.infer<typeof updateCategorySchema>
export type CategoryReorder = z.infer<typeof reorderCategoriesSchema>
export type WorkspaceInput = z.infer<typeof createWorkspaceSchema>

/** What both free-text entry points report back, enough to answer a person. */
export type QuickEntryResult = {
  id: string
  categoryName: string | null
  /** True when the category was matched from the text rather than chosen. */
  categoryGuessed: boolean
  amountKopecks: number
}

export type SessionUser = {
  id: string
  firstName: string
  username: string | null
  timezone: string
}

export interface FinanceStore {
  createSession(identity: TelegramIdentity, timezone: string): Promise<{ token: string; user: SessionUser }>
  userForSession(token: string): Promise<SessionUser | null>
  telegramUserIdFor(userId: string): Promise<number | null>
  /**
   * Records that the bot is allowed to write to this person and reports whether
   * they already use Lomme, so the bot can greet a newcomer differently.
   */
  noteBotContact(telegramUserId: number): Promise<{ known: boolean }>
  /**
   * False when this update was already handled. Telegram redelivers an update
   * whenever the webhook is slow to answer, and a replayed /start would send a
   * second greeting.
   */
  claimTelegramUpdate(updateId: number): Promise<boolean>
  /**
   * Gives a claimed update back after a delivery failure worth retrying, so
   * Telegram's redelivery is not silently swallowed as a duplicate.
   */
  releaseTelegramUpdate(updateId: number): Promise<void>
  revokeSession(token: string): Promise<void>
  snapshot(userId: string, workspaceId?: string, range?: SnapshotRange, accountId?: string | null): Promise<AppSnapshot>
  transactionsPage(userId: string, workspaceId: string, range: SnapshotRange, cursor?: string, limit?: number, accountId?: string | null): Promise<TransactionPage>
  createTransaction(userId: string, input: TransactionInput, idempotencyKey: string): Promise<{ id: string }>
  /** Issues a fresh shortcut key, replacing any previous one. Returns it once. */
  issueQuickKey(userId: string): Promise<{ key: string }>
  /** Whether the user currently has a shortcut key. */
  hasQuickKey(userId: string): Promise<boolean>
  /** Records one line from the shortcut, working the category out from its text. */
  createQuickEntry(key: string, input: QuickEntryInput): Promise<QuickEntryResult>
  /** The same, for a line typed straight into the bot chat. */
  createBotEntry(telegramUserId: number, input: QuickEntryInput): Promise<QuickEntryResult>
  updateTransaction(userId: string, transactionId: string, input: TransactionUpdate): Promise<void>
  deleteTransaction(userId: string, transactionId: string, version: number): Promise<void>
  createAccount(userId: string, input: AccountInput): Promise<{ id: string }>
  updateAccount(userId: string, accountId: string, input: AccountUpdate): Promise<void>
  archiveAccount(userId: string, accountId: string, version: number): Promise<void>
  setActiveAccount(userId: string, input: ActiveAccountInput): Promise<void>
  createAccountInvite(userId: string, accountId: string): Promise<{ id: string; token: string; expiresAt: string }>
  previewAccountInvite(userId: string, token: string): Promise<AccountInvitePreview>
  acceptAccountInvite(userId: string, token: string): Promise<{ workspaceId: string; accountId: string }>
  revokeAccountInvite(userId: string, accountId: string, inviteId: string): Promise<void>
  removeAccountMember(userId: string, accountId: string, memberUserId: string): Promise<void>
  leaveAccount(userId: string, accountId: string): Promise<void>
  createCategory(userId: string, input: CategoryInput): Promise<{ id: string }>
  updateCategory(userId: string, categoryId: string, input: CategoryUpdate): Promise<void>
  reorderCategories(userId: string, input: CategoryReorder): Promise<void>
  archiveCategory(userId: string, categoryId: string, version: number): Promise<void>
  createWorkspace(userId: string, input: WorkspaceInput): Promise<{ id: string }>
  createInvite(userId: string, workspaceId: string): Promise<{ token: string; expiresAt: string }>
  acceptInvite(userId: string, token: string): Promise<{ workspaceId: string }>
  removeMember(userId: string, workspaceId: string, memberUserId: string): Promise<void>
  runWorkerBatch(): Promise<{ expiredMedia: number; forgottenUpdates: number }>
  health(): Promise<{ database: 'ok' | 'memory' }>
  close(): Promise<void>
}
