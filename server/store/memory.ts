import { randomUUID } from 'node:crypto'
import { addDays, subDays } from 'date-fns'
import {
  type AccountView,
  type AccountInvitePreview,
  type AppSnapshot,
  type CategoryView,
  type MemberView,
  type TransactionView,
  type TransactionPage,
  type WorkspaceSummary,
} from '../../src/shared/contracts.js'
import type { TelegramIdentity } from '../auth/telegram.js'
import type { DeliveryKind, ReminderCandidate } from '../telegram/reminders.js'
import { calculateSummary } from '../lib/analytics.js'
import { issueQuickKey, quickKeyMatches } from '../lib/quick-key.js'
import { hintKeyword, parseQuickAmount, resolveQuickEntry } from '../../src/shared/quick-entry.js'
import { DATA_COLORS } from '../../src/shared/design-tokens.js'
import { resolveRange, type SnapshotRange } from '../lib/range.js'
import { decodeTransactionCursor, encodeTransactionCursor } from '../lib/transaction-cursor.js'
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js'
import { hashToken, randomToken } from '../lib/security.js'
import type {
  AccountInput,
  AccountUpdate,
  ActiveAccountInput,
  CategoryInput,
  CategoryReorder,
  CategoryUpdate,
  FinanceStore,
  QuickEntryInput,
  ReminderSettingsInput,
  SharedActivity,
  SessionUser,
  TransactionInput,
  TransactionUpdate,
  WorkspaceInput,
} from './types.js'
import { expenseCategories, incomeCategories } from './default-categories.js'

type InternalUser = SessionUser & {
  telegramUserId: number
  botWriteAccess: boolean
  activeWorkspaceId: string | null
  activeAccountId: string | null
}
type InternalWorkspace = { id: string; name: string; kind: 'personal' | 'family'; ownerUserId: string }
type InternalInvite = { workspaceId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }
type InternalAccountInvite = {
  id: string
  accountId: string
  createdByUserId: string
  tokenHash: string
  expiresAt: Date
  usedByUserId: string | null
  usedAt: Date | null
  revokedAt: Date | null
}


export class MemoryFinanceStore implements FinanceStore {
  private users = new Map<string, InternalUser>()
  private usersByTelegram = new Map<number, string>()
  private sessions = new Map<string, { userId: string; expiresAt: Date }>()
  private processedUpdates = new Set<number>()
  private reminders = new Map<string, { enabled: boolean; localTime: string; daysOfWeek: number[] }>()
  private reminderDeliveries = new Set<string>()
  private categoryHints = new Map<string, Map<string, string>>()
  private lastDelivery = new Map<string, Date>()
  private userCreatedAt = new Map<string, Date>()
  private workspaces = new Map<string, InternalWorkspace>()
  private members = new Map<string, MemberView[]>()
  private accounts = new Map<string, AccountView[]>()
  private categories = new Map<string, CategoryView[]>()
  private transactions = new Map<string, TransactionView[]>()
  private invites = new Map<string, InternalInvite>()
  private accountInvites = new Map<string, InternalAccountInvite>()
  private accountAccess = new Map<string, Map<string, 'owner' | 'editor'>>()
  private idempotency = new Map<string, string>()
  private quickKeys = new Map<string, string>()

  async createSession(identity: TelegramIdentity, timezone: string) {
    let userId = this.usersByTelegram.get(identity.id)
    if (!userId) {
      userId = randomUUID()
      const user: InternalUser = { id: userId, telegramUserId: identity.id, firstName: identity.firstName, username: identity.username, timezone, botWriteAccess: identity.allowsWriteToPm === true, activeWorkspaceId: null, activeAccountId: null }
      this.users.set(userId, user)
      this.usersByTelegram.set(identity.id, userId)
      this.userCreatedAt.set(userId, new Date())
      this.createPersonalSpace(user)
    } else {
      const user = this.users.get(userId)!
      user.firstName = identity.firstName
      user.username = identity.username
      user.timezone = timezone
      // A launch without the flag is not a revocation of a grant already given.
      user.botWriteAccess = user.botWriteAccess || identity.allowsWriteToPm === true
    }
    const token = randomToken()
    this.sessions.set(hashToken(token), { userId, expiresAt: addDays(new Date(), 30) })
    return { token, user: this.publicUser(this.users.get(userId)!) }
  }

  async userForSession(token: string) {
    const session = this.sessions.get(hashToken(token))
    if (!session || session.expiresAt < new Date()) return null
    const user = this.users.get(session.userId)
    return user ? this.publicUser(user) : null
  }

  async telegramUserIdFor(userId: string) { return this.users.get(userId)?.telegramUserId ?? null }

  async noteBotContact(telegramUserId: number) {
    const userId = this.usersByTelegram.get(telegramUserId)
    if (!userId) return { known: false }
    this.users.get(userId)!.botWriteAccess = true
    return { known: true }
  }

  async claimTelegramUpdate(updateId: number) {
    if (this.processedUpdates.has(updateId)) return false
    this.processedUpdates.add(updateId)
    return true
  }

  async releaseTelegramUpdate(updateId: number) { this.processedUpdates.delete(updateId) }

  async revokeSession(token: string) { this.sessions.delete(hashToken(token)) }

  async snapshot(userId: string, workspaceId?: string, range?: SnapshotRange, requestedAccountId?: string | null): Promise<AppSnapshot> {
    const user = this.requireUser(userId)
    const accessible = this.accessibleAccounts(userId).filter((item) => !item.archivedAt)
    const workspaceIds = new Set(accessible.map((item) => item.workspaceId))
    const available = [...this.workspaces.values()]
      .filter((workspace) => workspaceIds.has(workspace.id))
      .map((workspace): WorkspaceSummary => ({
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind,
        role: workspace.ownerUserId === userId ? 'owner' : 'member',
      }))

    const persisted = user.activeAccountId && accessible.find((item) => item.id === user.activeAccountId && !item.archivedAt)
    const requested = requestedAccountId === undefined ? persisted : requestedAccountId === null ? null : accessible.find((item) => item.id === requestedAccountId && !item.archivedAt)
    if (requestedAccountId && !requested) throw forbidden('Нет доступа к этому кошельку')
    const selectedAccount = requested || null
    const activeWorkspaceId = selectedAccount?.workspaceId
      || (workspaceId && available.some((item) => item.id === workspaceId) ? workspaceId : null)
      || (user.activeWorkspaceId && available.some((item) => item.id === user.activeWorkspaceId) ? user.activeWorkspaceId : null)
      || available[0]?.id
    if (!activeWorkspaceId) throw notFound('Пространство не найдено')

    const activeWorkspaceAccounts = accessible.filter((item) => item.workspaceId === activeWorkspaceId && !item.archivedAt)
    const scopedIds = new Set(selectedAccount ? [selectedAccount.id] : activeWorkspaceAccounts.map((item) => item.id))
    if (!scopedIds.size) throw notFound('Кошелёк не найден')
    const allWorkspaceTransactions = this.transactions.get(activeWorkspaceId) || []
    const scopedTransactions = allWorkspaceTransactions.filter((item) => scopedIds.has(item.accountId) || Boolean(item.targetAccountId && scopedIds.has(item.targetAccountId)))
    const usage = new Map<string, number>()
    for (const item of scopedTransactions) if (item.categoryId) usage.set(item.categoryId, (usage.get(item.categoryId) ?? 0) + 1)
    const categories = (this.categories.get(activeWorkspaceId) || []).map((item) => ({ ...item, usageCount: usage.get(item.id) ?? 0 }))
      .sort((left, right) => left.type.localeCompare(right.type) || left.order - right.order || left.name.localeCompare(right.name))

    const accountViews = accessible.map((account) => {
      const transactions = this.transactions.get(account.workspaceId) || []
      let balance = account.openingBalanceKopecks
      for (const item of transactions) {
        if (item.accountId === account.id) balance += item.type === 'income' ? item.amountKopecks : -item.amountKopecks
        if (item.type === 'transfer' && item.targetAccountId === account.id) balance += item.amountKopecks
      }
      return { ...account, balanceKopecks: balance }
    })
    const window = resolveRange(range)
    const page = this.pageFor(activeWorkspaceId, window, undefined, 20, scopedIds)
    const members = selectedAccount
      ? [...(this.accountAccess.get(selectedAccount.id)?.entries() || [])].map(([memberUserId, role]) => {
          const member = this.requireUser(memberUserId)
          return { userId: memberUserId, firstName: member.firstName, username: member.username, role }
        })
      : []
    return {
      user: { id: user.id, firstName: user.firstName, username: user.username, timezone: user.timezone },
      workspaces: available,
      activeWorkspaceId,
      activeAccountId: selectedAccount?.id || null,
      accounts: accountViews,
      categories,
      transactions: page.items,
      transactionsNextCursor: page.nextCursor,
      members,
      summary: calculateSummary(scopedTransactions, categories, window, new Date(), user.timezone),
    }
  }

  async transactionsPage(userId: string, workspaceId: string, range: SnapshotRange, cursor?: string, limit = 20, accountId?: string | null): Promise<TransactionPage> {
    const allowed = new Set(this.accessibleAccounts(userId).filter((item) => item.workspaceId === workspaceId && !item.archivedAt).map((item) => item.id))
    if (accountId) {
      if (!allowed.has(accountId)) throw forbidden('Нет доступа к этому кошельку')
      return this.pageFor(workspaceId, resolveRange(range), cursor, limit, new Set([accountId]))
    }
    if (!allowed.size) throw forbidden('Нет доступа к этому пространству')
    return this.pageFor(workspaceId, resolveRange(range), cursor, limit, allowed)
  }

  async issueQuickKey(userId: string) {
    this.requireUser(userId)
    const { key, hash } = issueQuickKey()
    this.quickKeys.set(userId, hash)
    return { key }
  }

  async hasQuickKey(userId: string) {
    this.requireUser(userId)
    return this.quickKeys.has(userId)
  }

  async createQuickEntry(key: string, input: QuickEntryInput) {
    const userId = [...this.quickKeys.entries()].find(([, hash]) => quickKeyMatches(key, hash))?.[0]
    if (!userId) throw new AppError(401, 'QUICK_KEY_INVALID', 'Ключ не подходит')
    return this.recordQuickEntry(userId, input, 'shortcut')
  }

  async createBotEntry(telegramUserId: number, input: QuickEntryInput) {
    const userId = this.usersByTelegram.get(telegramUserId)
    if (!userId) throw new AppError(404, 'BOT_USER_UNKNOWN', 'Сначала откройте приложение')
    return this.recordQuickEntry(userId, input, 'bot')
  }

  private botEntry(telegramUserId: number, transactionId: string) {
    const userId = this.usersByTelegram.get(telegramUserId)
    if (!userId) return null
    const user = this.users.get(userId)!
    for (const [workspaceId, entries] of this.transactions) {
      const found = entries.find((item) => item.id === transactionId
        && item.source === 'bot'
        && item.authorName === user.firstName)
      if (found) return { userId, workspaceId, entry: found }
    }
    return null
  }

  async botCategoryChoices(telegramUserId: number, transactionId: string) {
    const found = this.botEntry(telegramUserId, transactionId)
    if (!found) return null
    return {
      transactionId,
      currentCategoryId: found.entry.categoryId,
      categories: (this.categories.get(found.workspaceId) || [])
        .filter((item) => item.type === 'expense' && !item.archivedAt)
        .map((item) => ({ id: item.id, name: item.name })),
    }
  }

  async correctBotEntry(telegramUserId: number, transactionId: string, categoryPrefix: string) {
    const found = this.botEntry(telegramUserId, transactionId)
    if (!found) return null
    const matches = (this.categories.get(found.workspaceId) || [])
      .filter((item) => item.type === 'expense' && !item.archivedAt && item.id.startsWith(categoryPrefix))
    if (matches.length !== 1) return null
    const category = matches[0]!
    found.entry.categoryId = category.id
    found.entry.categoryGuessed = false
    found.entry.version += 1
    const keyword = hintKeyword(found.entry.note)
    if (keyword) {
      const hints = this.categoryHints.get(found.workspaceId) || new Map<string, string>()
      hints.set(keyword, category.id)
      this.categoryHints.set(found.workspaceId, hints)
    }
    return { categoryName: category.name, amountKopecks: found.entry.amountKopecks, keyword }
  }

  async deleteBotEntry(telegramUserId: number, transactionId: string) {
    const found = this.botEntry(telegramUserId, transactionId)
    if (!found) return null
    this.transactions.set(found.workspaceId, (this.transactions.get(found.workspaceId) || [])
      .filter((item) => item.id !== transactionId))
    return { amountKopecks: found.entry.amountKopecks }
  }

  private async recordQuickEntry(userId: string, input: QuickEntryInput, source: 'shortcut' | 'bot') {
    const amountKopecks = parseQuickAmount(input.amount)
    if (!amountKopecks) throw new AppError(400, 'QUICK_AMOUNT_INVALID', 'Не разобрали сумму')

    const user = this.requireUser(userId)
    const accessible = this.accessibleAccounts(userId).filter((item) => !item.archivedAt)
    const account = accessible.find((item) => item.id === user.activeAccountId) || accessible[0]
    if (!account) throw notFound('Счёт не найден')
    const workspaceId = account.workspaceId

    const categories = this.categories.get(workspaceId) || []
    const history = (this.transactions.get(workspaceId) || [])
      .slice().sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 300)
    const entry = resolveQuickEntry(input.text, amountKopecks, categories, history, this.categoryHints.get(workspaceId))

    const transaction: TransactionView = {
      id: randomUUID(), type: 'expense', amountKopecks: entry.amountKopecks, accountId: account.id,
      targetAccountId: null, categoryId: entry.categoryId, occurredAt: new Date().toISOString(),
      note: entry.note, source, authorName: this.requireUser(userId).firstName, version: 1,
      categoryGuessed: entry.categoryGuessed,
    }
    this.transactions.set(workspaceId, [transaction, ...(this.transactions.get(workspaceId) || [])])
    return {
      id: transaction.id,
      categoryName: categories.find((item) => item.id === entry.categoryId)?.name ?? null,
      categoryGuessed: entry.categoryGuessed,
      amountKopecks: entry.amountKopecks,
    }
  }

  async createTransaction(userId: string, input: TransactionInput, idempotencyKey: string) {
    this.requireAccountAccess(userId, input.accountId)
    if (input.targetAccountId) this.requireAccountAccess(userId, input.targetAccountId)
    const uniqueKey = `${userId}:transaction:${idempotencyKey}`
    const existing = this.idempotency.get(uniqueKey)
    if (existing) return { id: existing }
    this.validateTransactionRelations(input.workspaceId, input)
    const transaction: TransactionView = {
      id: randomUUID(), type: input.type, amountKopecks: input.amountKopecks, accountId: input.accountId,
      targetAccountId: input.targetAccountId || null, categoryId: input.categoryId || null, occurredAt: input.occurredAt,
      note: input.note, source: input.source, authorName: this.requireUser(userId).firstName, version: 1,
    }
    this.transactions.get(input.workspaceId)!.push(transaction)
    this.idempotency.set(uniqueKey, transaction.id)
    return { id: transaction.id }
  }

  async updateTransaction(userId: string, transactionId: string, input: TransactionUpdate) {
    const match = this.findTransaction(transactionId)
    this.requireAccountAccess(userId, match.transaction.accountId)
    if (match.transaction.targetAccountId) this.requireAccountAccess(userId, match.transaction.targetAccountId)
    if (match.transaction.version !== input.version) throw conflict()
    this.validateTransactionRelations(match.workspaceId, input)
    this.requireAccountAccess(userId, input.accountId)
    if (input.targetAccountId) this.requireAccountAccess(userId, input.targetAccountId)
    Object.assign(match.transaction, input, { targetAccountId: input.targetAccountId || null, categoryId: input.categoryId || null, version: input.version + 1 })
  }

  async deleteTransaction(userId: string, transactionId: string, version: number) {
    const match = this.findTransaction(transactionId)
    this.requireAccountAccess(userId, match.transaction.accountId)
    if (match.transaction.targetAccountId) this.requireAccountAccess(userId, match.transaction.targetAccountId)
    if (match.transaction.version !== version) throw conflict()
    this.transactions.set(match.workspaceId, match.list.filter((item) => item.id !== transactionId))
  }

  async createAccount(userId: string, input: AccountInput) {
    this.requireWorkspaceOwner(userId, input.workspaceId)
    const account: AccountView = { id: randomUUID(), workspaceId: input.workspaceId, name: input.name, kind: input.kind, icon: input.icon, color: input.color, openingBalanceKopecks: input.openingBalanceKopecks, balanceKopecks: input.openingBalanceKopecks, version: 1, archivedAt: null, accessRole: 'owner', memberCount: 1 }
    this.accounts.get(input.workspaceId)!.push(account)
    this.accountAccess.set(account.id, new Map([[userId, 'owner']]))
    const user = this.requireUser(userId)
    user.activeWorkspaceId = input.workspaceId
    user.activeAccountId = account.id
    return { id: account.id }
  }

  async updateAccount(userId: string, accountId: string, input: AccountUpdate) {
    const account = this.findAccount(accountId)
    if (this.requireAccountAccess(userId, accountId) !== 'owner') throw forbidden('Только владелец переименовывает кошелёк')
    if (account.version !== input.version) throw conflict('Кошелёк уже изменён — обновите экран')
    account.name = input.name
    account.version += 1
  }

  async archiveAccount(userId: string, accountId: string, version: number) {
    for (const items of this.accounts.values()) {
      const account = items.find((item) => item.id === accountId)
      if (!account) continue
      if (this.requireAccountAccess(userId, accountId) !== 'owner') throw forbidden('Только владелец удаляет кошелёк')
      if (account.version !== version) throw conflict()
      const remainingOwned = this.accessibleAccounts(userId).filter((item) => item.id !== accountId && item.accessRole === 'owner' && !item.archivedAt)
      if (!remainingOwned.length) throw conflict('Нельзя удалить последний личный кошелёк')
      account.archivedAt = new Date().toISOString(); account.version += 1
      for (const invite of this.accountInvites.values()) if (invite.accountId === accountId && !invite.usedAt) invite.revokedAt = new Date()
      for (const memberUserId of this.accountAccess.get(accountId)?.keys() || []) {
        const member = this.users.get(memberUserId)
        if (member?.activeAccountId === accountId) {
          const fallback = this.accessibleAccounts(memberUserId).find((item) => item.id !== accountId && !item.archivedAt)
          member.activeAccountId = fallback?.id || null
          member.activeWorkspaceId = fallback?.workspaceId || null
        }
      }
      return
    }
    throw notFound('Счёт не найден')
  }

  async setActiveAccount(userId: string, input: ActiveAccountInput) {
    const user = this.requireUser(userId)
    if (input.accountId) {
      const account = this.findAccount(input.accountId)
      this.requireAccountAccess(userId, input.accountId)
      if (account.workspaceId !== input.workspaceId || account.archivedAt) throw forbidden('Кошелёк недоступен')
    } else if (!this.accessibleAccounts(userId).some((item) => item.workspaceId === input.workspaceId && !item.archivedAt)) {
      throw forbidden('Нет доступных кошельков в этом пространстве')
    }
    user.activeWorkspaceId = input.workspaceId
    user.activeAccountId = input.accountId
  }

  async createAccountInvite(userId: string, accountId: string) {
    const account = this.findAccount(accountId)
    if (this.requireAccountAccess(userId, accountId) !== 'owner' || account.archivedAt) throw forbidden('Только владелец создаёт приглашения')
    const token = randomToken(24)
    const invite: InternalAccountInvite = { id: randomUUID(), accountId, createdByUserId: userId, tokenHash: hashToken(token), expiresAt: addDays(new Date(), 1), usedByUserId: null, usedAt: null, revokedAt: null }
    this.accountInvites.set(invite.tokenHash, invite)
    return { id: invite.id, token, expiresAt: invite.expiresAt.toISOString() }
  }

  async previewAccountInvite(_userId: string, token: string): Promise<AccountInvitePreview> {
    const invite = this.accountInvites.get(hashToken(token))
    if (!invite) throw notFound('Приглашение не найдено')
    const account = this.findAccount(invite.accountId)
    const inviter = this.requireUser(invite.createdByUserId)
    const status = invite.revokedAt ? 'revoked' : invite.usedAt ? 'accepted' : invite.expiresAt < new Date() ? 'expired' : 'active'
    return { accountId: account.id, workspaceId: account.workspaceId, accountName: account.name, inviterName: inviter.firstName, role: 'editor', expiresAt: invite.expiresAt.toISOString(), status }
  }

  async acceptAccountInvite(userId: string, token: string) {
    const invite = this.accountInvites.get(hashToken(token))
    if (!invite || invite.revokedAt || invite.expiresAt < new Date()) throw conflict('Приглашение недействительно или истекло')
    if (invite.createdByUserId === userId) throw conflict('Нельзя принять собственное приглашение')
    if (invite.usedAt) {
      if (invite.usedByUserId !== userId) throw conflict('Приглашение уже использовано')
      const account = this.findAccount(invite.accountId)
      return { workspaceId: account.workspaceId, accountId: account.id }
    }
    const account = this.findAccount(invite.accountId)
    const user = this.requireUser(userId)
    const workspaceMembers = this.members.get(account.workspaceId) || []
    if (!workspaceMembers.some((item) => item.userId === userId)) workspaceMembers.push({ userId, firstName: user.firstName, username: user.username, role: 'editor' })
    this.members.set(account.workspaceId, workspaceMembers)
    const access = this.accountAccess.get(account.id) || new Map<string, 'owner' | 'editor'>()
    access.set(userId, 'editor')
    this.accountAccess.set(account.id, access)
    invite.usedAt = new Date()
    invite.usedByUserId = userId
    user.activeWorkspaceId = account.workspaceId
    user.activeAccountId = account.id
    const inviter = this.users.get(invite.createdByUserId)
    return {
      workspaceId: account.workspaceId,
      accountId: account.id,
      joined: {
        inviterTelegramUserId: inviter?.botWriteAccess ? inviter.telegramUserId : null,
        accountName: account.name,
        memberName: user.firstName,
      },
    }
  }

  async revokeAccountInvite(userId: string, accountId: string, inviteId: string) {
    if (this.requireAccountAccess(userId, accountId) !== 'owner') throw forbidden('Только владелец отзывает приглашения')
    const invite = [...this.accountInvites.values()].find((item) => item.id === inviteId && item.accountId === accountId)
    if (!invite || invite.usedAt) throw notFound('Активное приглашение не найдено')
    invite.revokedAt = new Date()
  }

  async removeAccountMember(userId: string, accountId: string, memberUserId: string) {
    if (this.requireAccountAccess(userId, accountId) !== 'owner') throw forbidden('Только владелец управляет участниками')
    if (userId === memberUserId) throw forbidden('Владелец не может удалить себя')
    const access = this.accountAccess.get(accountId)
    if (access?.get(memberUserId) !== 'editor') throw notFound('Участник не найден')
    access.delete(memberUserId)
    this.fallbackAfterAccessLoss(memberUserId, accountId)
  }

  async leaveAccount(userId: string, accountId: string) {
    if (this.requireAccountAccess(userId, accountId) === 'owner') throw forbidden('Владелец не может покинуть свой кошелёк')
    this.accountAccess.get(accountId)?.delete(userId)
    this.fallbackAfterAccessLoss(userId, accountId)
  }

  async createCategory(userId: string, input: CategoryInput) {
    this.requireWorkspaceOwner(userId, input.workspaceId)
    const categories = this.categories.get(input.workspaceId)!
    this.validateCategoryParent(categories, input.type, input.parentId || null)
    const order = input.order ?? Math.max(-1, ...categories.filter((item) => item.type === input.type && !item.archivedAt).map((item) => item.order)) + 1
    const category: CategoryView = { id: randomUUID(), type: input.type, name: input.name, icon: input.icon, color: input.color, parentId: input.parentId || null, order, version: 1, archivedAt: null }
    categories.push(category)
    return { id: category.id }
  }

  async updateCategory(userId: string, categoryId: string, input: CategoryUpdate) {
    for (const [workspaceId, items] of this.categories) {
      const category = items.find((item) => item.id === categoryId && !item.archivedAt)
      if (!category) continue
      this.requireWorkspaceOwner(userId, workspaceId)
      if (category.version !== input.version) throw conflict()
      this.validateCategoryParent(items, input.type, input.parentId || null, categoryId)
      const typeChanged = category.type !== input.type
      Object.assign(category, {
        type: input.type,
        name: input.name,
        icon: input.icon,
        color: input.color,
        parentId: input.parentId || null,
        order: typeChanged ? Math.max(-1, ...items.filter((item) => item.type === input.type && item.id !== categoryId && !item.archivedAt).map((item) => item.order)) + 1 : category.order,
        version: category.version + 1,
      })
      return
    }
    throw notFound('Категория не найдена')
  }

  async reorderCategories(userId: string, input: CategoryReorder) {
    this.requireWorkspaceOwner(userId, input.workspaceId)
    const items = this.categories.get(input.workspaceId) || []
    const active = items.filter((item) => item.type === input.type && !item.archivedAt)
    if (active.length !== input.categoryIds.length || active.some((item) => !input.categoryIds.includes(item.id))) throw conflict('Список категорий изменился — обновите экран')
    const order = new Map(input.categoryIds.map((id, index) => [id, index]))
    for (const item of active) { item.order = order.get(item.id)!; item.version += 1 }
  }

  async archiveCategory(userId: string, categoryId: string, version: number) {
    for (const [workspaceId, items] of this.categories) {
      const category = items.find((item) => item.id === categoryId)
      if (!category) continue
      this.requireWorkspaceOwner(userId, workspaceId)
      if (category.version !== version) throw conflict()
      category.archivedAt = new Date().toISOString(); category.version += 1
      for (const child of items.filter((item) => item.parentId === categoryId && !item.archivedAt)) { child.parentId = null; child.version += 1 }
      return
    }
    throw notFound('Категория не найдена')
  }

  async createWorkspace(userId: string, input: WorkspaceInput) {
    const user = this.requireUser(userId)
    const workspace: InternalWorkspace = { id: randomUUID(), name: input.name, kind: 'family', ownerUserId: userId }
    this.workspaces.set(workspace.id, workspace)
    this.members.set(workspace.id, [{ userId, firstName: user.firstName, username: user.username, role: 'owner' }])
    this.seedWorkspace(workspace.id)
    return { id: workspace.id }
  }

  async createInvite(userId: string, workspaceId: string) {
    const member = this.requireMember(userId, workspaceId)
    if (member.role !== 'owner' || this.workspaces.get(workspaceId)?.kind !== 'family') throw forbidden('Только владелец семейного кошелька создаёт приглашения')
    const token = randomToken(24)
    const expiresAt = addDays(new Date(), 1)
    this.invites.set(hashToken(token), { workspaceId, tokenHash: hashToken(token), expiresAt, usedAt: null })
    return { token, expiresAt: expiresAt.toISOString() }
  }

  async acceptInvite(userId: string, token: string) {
    const invite = this.invites.get(hashToken(token))
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) throw conflict('Приглашение недействительно или уже использовано')
    const user = this.requireUser(userId)
    const members = this.members.get(invite.workspaceId)!
    if (!members.some((member) => member.userId === userId)) members.push({ userId, firstName: user.firstName, username: user.username, role: 'editor' })
    for (const account of this.accounts.get(invite.workspaceId) || []) {
      const access = this.accountAccess.get(account.id) || new Map<string, 'owner' | 'editor'>()
      access.set(userId, 'editor')
      this.accountAccess.set(account.id, access)
    }
    invite.usedAt = new Date()
    return { workspaceId: invite.workspaceId }
  }

  async removeMember(userId: string, workspaceId: string, memberUserId: string) {
    const current = this.requireMember(userId, workspaceId)
    if (current.role !== 'owner') throw forbidden('Только владелец управляет участниками')
    if (userId === memberUserId) throw forbidden('Владелец не может удалить себя')
    this.members.set(workspaceId, this.members.get(workspaceId)!.filter((member) => member.userId !== memberUserId))
    for (const account of this.accounts.get(workspaceId) || []) this.accountAccess.get(account.id)?.delete(memberUserId)
  }

  async reminderSettings(userId: string) {
    return this.reminders.get(userId) ?? { enabled: false, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }
  }

  async saveReminderSettings(userId: string, input: ReminderSettingsInput) {
    this.requireUser(userId)
    this.reminders.set(userId, { enabled: input.enabled, localTime: input.localTime, daysOfWeek: [...input.daysOfWeek].sort() })
    return this.reminderSettings(userId)
  }

  async reminderCandidates(): Promise<ReminderCandidate[]> {
    const candidates: ReminderCandidate[] = []
    for (const [userId, settings] of this.reminders) {
      const user = this.users.get(userId)
      if (!settings.enabled || !user?.botWriteAccess) continue
      const own = [...this.transactions.values()].flat()
        .filter((entry) => entry.authorName === user.firstName)
        .map((entry) => new Date(entry.occurredAt).getTime())
      candidates.push({
        userId,
        telegramUserId: user.telegramUserId,
        timezone: user.timezone,
        localTime: settings.localTime,
        daysOfWeek: settings.daysOfWeek,
        lastEntryAt: own.length ? new Date(Math.max(...own)) : null,
        deliveredCount: [...this.reminderDeliveries].filter((key) => key.startsWith(`${userId}:daily:`)).length,
        lastDeliveryAt: this.lastDelivery.get(userId) ?? null,
        createdAt: this.userCreatedAt.get(userId) ?? new Date(0),
        entryCount: own.length,
        hasQuickKey: this.quickKeys.has(userId),
        hasSharedWallet: [...this.accountAccess.values()].some((access) => access.size > 1 && access.has(userId)),
        sentKinds: new Set([...this.reminderDeliveries]
          .filter((key) => key.startsWith(`${userId}:`))
          .map((key) => key.split(':')[1]!)),
      })
    }
    return candidates
  }

  async sharedActivitySince(userId: string, since: Date): Promise<SharedActivity | null> {
    const user = this.users.get(userId)
    const accountId = user?.activeAccountId
    if (!accountId) return null
    const access = this.accountAccess.get(accountId)
    if (!access || access.size < 2) return null
    const account = this.findAccount(accountId)

    const totals = new Map<string, { count: number; amountKopecks: number }>()
    for (const entry of this.transactions.get(account.workspaceId) || []) {
      if (entry.accountId !== accountId || entry.type !== 'expense') continue
      if (new Date(entry.occurredAt) < since) continue
      const current = totals.get(entry.authorName) || { count: 0, amountKopecks: 0 }
      totals.set(entry.authorName, { count: current.count + 1, amountKopecks: current.amountKopecks + entry.amountKopecks })
    }
    const byAuthor = [...totals.entries()]
      .map(([name, value]) => ({ name, ...value, isSelf: name === user!.firstName }))
      .sort((left, right) => right.amountKopecks - left.amountKopecks)
    if (!byAuthor.some((item) => !item.isSelf)) return null
    return { accountName: account.name, byAuthor }
  }

  async claimDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date) {
    const key = `${userId}:${kind}:${scheduledFor.toISOString()}`
    if (this.reminderDeliveries.has(key)) return false
    this.reminderDeliveries.add(key)
    return true
  }

  async settleDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date, error?: string) {
    if (!error) this.lastDelivery.set(userId, scheduledFor)
  }

  async releaseDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date) {
    this.reminderDeliveries.delete(`${userId}:${kind}:${scheduledFor.toISOString()}`)
  }

  async revokeBotWriteAccess(telegramUserId: number) {
    const userId = this.usersByTelegram.get(telegramUserId)
    if (userId) this.users.get(userId)!.botWriteAccess = false
  }

  async runWorkerBatch() { this.processedUpdates.clear(); return { expiredMedia: 0, forgottenUpdates: 0 } }
  async health() { return { database: 'memory' as const } }
  async close() {}

  private publicUser(user: InternalUser): SessionUser { return { id: user.id, firstName: user.firstName, username: user.username, timezone: user.timezone } }
  private requireUser(userId: string) { const user = this.users.get(userId); if (!user) throw forbidden(); return user }
  private requireMember(userId: string, workspaceId: string) { this.requireUser(userId); const member = this.members.get(workspaceId)?.find((item) => item.userId === userId); if (!member) throw forbidden('Нет доступа к этому пространству'); return member }
  private requireWorkspaceOwner(userId: string, workspaceId: string) {
    this.requireUser(userId)
    if (this.workspaces.get(workspaceId)?.ownerUserId !== userId) throw forbidden('Только владелец управляет структурой кошелька')
  }
  private requireAccountAccess(userId: string, accountId: string) {
    this.requireUser(userId)
    const role = this.accountAccess.get(accountId)?.get(userId)
    if (!role || this.findAccount(accountId).archivedAt) throw forbidden('Нет доступа к этому кошельку')
    return role
  }
  private findAccount(accountId: string) {
    for (const items of this.accounts.values()) {
      const account = items.find((item) => item.id === accountId)
      if (account) return account
    }
    throw notFound('Кошелёк не найден')
  }
  private accessibleAccounts(userId: string) {
    const views: AccountView[] = []
    for (const items of this.accounts.values()) {
      for (const account of items) {
        const access = this.accountAccess.get(account.id)
        const role = access?.get(userId)
        if (role) views.push({ ...account, accessRole: role, memberCount: access?.size || 1 })
      }
    }
    return views
  }
  private fallbackAfterAccessLoss(userId: string, accountId: string) {
    const user = this.requireUser(userId)
    if (user.activeAccountId !== accountId) return
    const fallback = this.accessibleAccounts(userId).find((item) => !item.archivedAt)
    user.activeAccountId = fallback?.id || null
    user.activeWorkspaceId = fallback?.workspaceId || null
  }
  private findTransaction(id: string) { for (const [workspaceId, list] of this.transactions) { const transaction = list.find((item) => item.id === id); if (transaction) return { workspaceId, list, transaction } } throw notFound('Операция не найдена') }
  private validateTransactionRelations(workspaceId: string, input: Pick<TransactionInput, 'accountId' | 'targetAccountId' | 'categoryId'>) {
    const accountIds = new Set((this.accounts.get(workspaceId) || []).map((item) => item.id))
    const categoryIds = new Set((this.categories.get(workspaceId) || []).map((item) => item.id))
    if (!accountIds.has(input.accountId) || (input.targetAccountId && !accountIds.has(input.targetAccountId)) || (input.categoryId && !categoryIds.has(input.categoryId))) throw forbidden('Связанный объект принадлежит другому пространству')
  }
  private pageFor(workspaceId: string, range: { start: Date; end: Date }, rawCursor?: string, requestedLimit = 20, scopedAccountIds?: Set<string>): TransactionPage {
    const cursor = decodeTransactionCursor(rawCursor)
    const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
    const ordered = (this.transactions.get(workspaceId) || [])
      .filter((item) => {
        if (scopedAccountIds && !scopedAccountIds.has(item.accountId) && !(item.targetAccountId && scopedAccountIds.has(item.targetAccountId))) return false
        const at = new Date(item.occurredAt)
        if (at < range.start || at > range.end) return false
        return !cursor || item.occurredAt < cursor.occurredAt || (item.occurredAt === cursor.occurredAt && item.id < cursor.id)
      })
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
    const items = ordered.slice(0, limit)
    const last = items.at(-1)
    return {
      items,
      nextCursor: ordered.length > limit && last ? encodeTransactionCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    }
  }
  private createPersonalSpace(user: InternalUser) {
    const workspace: InternalWorkspace = { id: randomUUID(), name: 'Личные финансы', kind: 'personal', ownerUserId: user.id }
    this.workspaces.set(workspace.id, workspace)
    this.members.set(workspace.id, [{ userId: user.id, firstName: user.firstName, username: user.username, role: 'owner' }])
    this.seedWorkspace(workspace.id, user.firstName)
    const account = this.accounts.get(workspace.id)?.[0]
    user.activeWorkspaceId = workspace.id
    user.activeAccountId = account?.id || null
  }
  private seedWorkspace(workspaceId: string, authorName = 'Вы') {
    const ownerUserId = this.workspaces.get(workspaceId)?.ownerUserId
    const account: AccountView = { id: randomUUID(), workspaceId, name: 'Кошелёк', kind: 'cash', icon: 'wallet', color: DATA_COLORS.accountDefault, openingBalanceKopecks: 0, balanceKopecks: 0, version: 1, archivedAt: null, accessRole: 'owner', memberCount: 1 }
    this.accounts.set(workspaceId, [account])
    if (ownerUserId) this.accountAccess.set(account.id, new Map([[ownerUserId, 'owner']]))
    const categories: CategoryView[] = [...expenseCategories.map(([name, icon, color], order) => ({ id: randomUUID(), type: 'expense' as const, name, icon, color, parentId: null, order, version: 1, archivedAt: null })), ...incomeCategories.map(([name, icon, color], order) => ({ id: randomUUID(), type: 'income' as const, name, icon, color, parentId: null, order, version: 1, archivedAt: null }))]
    this.categories.set(workspaceId, categories)
    const occurredAt = (daysAgo: number, hour: number) => { const date = subDays(new Date(), daysAgo); date.setHours(hour, 0, 0, 0); return date.toISOString() }
    this.transactions.set(workspaceId, [
      { id: randomUUID(), type: 'income', amountKopecks: 100_000_00, accountId: account.id, targetAccountId: null, categoryId: null, occurredAt: occurredAt(2, 17), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 5_999_00, accountId: account.id, targetAccountId: null, categoryId: categories.find((item) => item.name === 'Транспорт')!.id, occurredAt: occurredAt(2, 16), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'income', amountKopecks: 50_000_00, accountId: account.id, targetAccountId: null, categoryId: null, occurredAt: occurredAt(2, 15), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 4_708_00, accountId: account.id, targetAccountId: null, categoryId: categories.find((item) => item.name === 'Жилищные расходы')!.id, occurredAt: occurredAt(2, 14), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 5_580_00, accountId: account.id, targetAccountId: null, categoryId: categories.find((item) => item.name === 'Здоровье')!.id, occurredAt: occurredAt(2, 13), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'income', amountKopecks: 50_000_00, accountId: account.id, targetAccountId: null, categoryId: null, occurredAt: occurredAt(4, 16), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 5_000_00, accountId: account.id, targetAccountId: null, categoryId: null, occurredAt: occurredAt(4, 15), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 555_00, accountId: account.id, targetAccountId: null, categoryId: categories.find((item) => item.name === 'Развлечения')!.id, occurredAt: occurredAt(4, 14), note: '', source: 'manual', authorName, version: 1 },
      { id: randomUUID(), type: 'expense', amountKopecks: 150_00, accountId: account.id, targetAccountId: null, categoryId: categories.find((item) => item.name === 'Кафе и рестораны')!.id, occurredAt: occurredAt(4, 13), note: '', source: 'manual', authorName, version: 1 },
    ])
  }

  private validateCategoryParent(items: CategoryView[], type: CategoryView['type'], parentId: string | null, categoryId?: string) {
    if (!parentId) return
    if (parentId === categoryId) throw conflict('Категория не может быть родительской для самой себя')
    const parent = items.find((item) => item.id === parentId && !item.archivedAt)
    if (!parent || parent.type !== type) throw conflict('Родительская категория должна быть того же типа')
    const visited = new Set<string>()
    let cursor: CategoryView | undefined = parent
    while (cursor?.parentId) {
      if (cursor.parentId === categoryId) throw conflict('Нельзя создать цикл категорий')
      if (visited.has(cursor.parentId)) break
      visited.add(cursor.parentId)
      cursor = items.find((item) => item.id === cursor?.parentId)
    }
  }
}
