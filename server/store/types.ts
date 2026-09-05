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
  reminderSettingsSchema,
  updateCategorySchema,
  updateTransactionSchema,
  updateAccountSchema,
  activeAccountSchema,
} from '../../src/shared/contracts.js'
import type { TelegramIdentity } from '../auth/telegram.js'
import type { DeliveryKind, ReminderCandidate } from '../telegram/reminders.js'

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
export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>
export type ReminderSettings = ReminderSettingsInput

/** What both free-text entry points report back, enough to answer a person. */
export type QuickEntryResult = {
  id: string
  categoryName: string | null
  /** True when the category was matched from the text rather than chosen. */
  categoryGuessed: boolean
  amountKopecks: number
}

/**
 * `joined` is present only the first time an invite is accepted, and carries
 * what the bot needs to tell the person who sent it. A second acceptance of
 * the same link is idempotent and silent.
 */
export type AcceptedInvite = {
  workspaceId: string
  accountId: string
  joined?: { inviterTelegramUserId: number | null; accountName: string; memberName: string }
}

/** One evening's worth of activity in a wallet shared with other people. */
export type SharedActivity = {
  accountName: string
  byAuthor: Array<{ name: string; count: number; amountKopecks: number; isSelf: boolean }>
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
  acceptAccountInvite(userId: string, token: string): Promise<AcceptedInvite>
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
  reminderSettings(userId: string): Promise<ReminderSettings>
  saveReminderSettings(userId: string, input: ReminderSettingsInput): Promise<ReminderSettings>
  /** Everyone a daily reminder could reach; who actually gets one is decided per person. */
  reminderCandidates(): Promise<ReminderCandidate[]>
  /**
   * What other people put into this person's shared wallet since `since`.
   * Null when they have no shared wallet or nobody else recorded anything —
   * a digest of one's own entries would be telling someone what they did.
   */
  sharedActivitySince(userId: string, since: Date): Promise<SharedActivity | null>
  /** False when this slot was already claimed by another worker tick. */
  claimDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date): Promise<boolean>
  settleDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date, error?: string): Promise<void>
  releaseDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date): Promise<void>
  /** Telegram says this chat is gone for good; stop writing to it. */
  revokeBotWriteAccess(telegramUserId: number): Promise<void>
  runWorkerBatch(): Promise<{ expiredMedia: number; forgottenUpdates: number }>
  health(): Promise<{ database: 'ok' | 'memory' }>
  close(): Promise<void>
}
