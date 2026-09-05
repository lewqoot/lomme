/**
 * Turns one Telegram update into at most one reply.
 *
 * The router itself performs no network calls and reads no environment beyond
 * what it is handed, so every branch below is testable without a live bot.
 */

import { parseQuickLine } from '../../src/shared/quick-entry.js'
import type { BotMessage } from './api.js'
import * as texts from './texts.js'

export type TelegramUpdate = {
  update_id?: number
  message?: {
    text?: string
    chat?: { id?: number; type?: string }
    from?: { id?: number; is_bot?: boolean }
    voice?: unknown
    audio?: unknown
    photo?: unknown
    document?: unknown
    video_note?: unknown
  }
  callback_query?: {
    id: string
    data?: string
    from?: { id?: number }
    message?: { chat?: { id?: number }; message_id?: number }
  }
}

/** What the store gives back once a line of text has been recorded. */
export type RecordedEntry = {
  id: string
  categoryName: string | null
  categoryGuessed: boolean
  amountKopecks: number
}

export type RecordOutcome =
  | { status: 'recorded'; entry: RecordedEntry }
  /** They wrote to the bot before ever opening the Mini App. */
  | { status: 'no-account' }
  | { status: 'failed' }

export type RouterContext = {
  /** Where the bot's buttons may point; either half can be missing. */
  links: texts.LinkContext
  /** Marks the chat as reachable and reports whether this person is already a user. */
  noteBotContact(telegramUserId: number): Promise<{ known: boolean }>
  /** Resolves an invite token into a wallet name and its deep link. */
  resolveInvite(token: string): Promise<{ accountName: string; url: string } | null>
  /** Records one line of free text as an expense. */
  recordEntry(telegramUserId: number, amount: string, text: string): Promise<RecordOutcome>
  /** Categories the bot may offer for an entry, or null if it is not theirs. */
  categoryChoices(telegramUserId: number, transactionId: string): Promise<{
    categories: Array<{ id: string; name: string }>
    currentCategoryId: string | null
  } | null>
  /** Moves the entry and remembers the choice; null if the entry is gone. */
  correctCategory(telegramUserId: number, transactionId: string, categoryPrefix: string): Promise<{
    categoryName: string
    amountKopecks: number
    keyword: string | null
  } | null>
  /** Removes the entry; null if it is already gone. */
  deleteEntry(telegramUserId: number, transactionId: string): Promise<{ amountKopecks: number } | null>
}

export type RouterAction =
  | { kind: 'none' }
  | { kind: 'send'; chatId: number; message: BotMessage }
  | { kind: 'answer'; callbackQueryId: string; chatId: number; message: BotMessage; replaceMessageId?: number }

const START_WITH_INVITE = /^\/start(?:@[A-Za-z0-9_]+)?\s+invite_([A-Za-z0-9_-]{20,120})$/
const BARE_COMMAND = /^\/([a-z_]{1,32})(?:@[A-Za-z0-9_]+)?$/
const HAS_DIGIT = /\d/

/**
 * The reply for a recorded expense. Exported because a redelivered update has
 * to repeat exactly this message, rebuilt from the expense the first attempt
 * already wrote.
 */
export function confirmation(entry: RecordedEntry): BotMessage {
  if (!entry.categoryName) return texts.recordedWithoutCategory(entry.amountKopecks, entry.id)
  return entry.categoryGuessed
    ? texts.recordedGuess(entry.amountKopecks, entry.categoryName, entry.id)
    : texts.recorded(entry.amountKopecks, entry.categoryName, entry.id)
}

const CALLBACK = /^(cat|set|del|keep):([0-9a-f-]{36})(?::([0-9a-f]{8}))?$/

/**
 * A button press. Every branch identifies the person from the callback's own
 * sender, so a forwarded or replayed button cannot act on somebody else's
 * entry — the store checks ownership again on its side.
 */
async function handleButton(data: string, telegramUserId: number | null, context: RouterContext): Promise<BotMessage> {
  const parsed = CALLBACK.exec(data)
  if (!parsed || telegramUserId === null) return texts.fallback(context.links)
  const [, action, transactionId, categoryPrefix] = parsed

  if (action === 'keep') return texts.entryGone()

  if (action === 'cat') {
    const choices = await context.categoryChoices(telegramUserId, transactionId!)
    return choices
      ? texts.chooseCategory(transactionId!, choices.categories, choices.currentCategoryId)
      : texts.entryGone()
  }

  if (action === 'set') {
    if (!categoryPrefix) return texts.entryGone()
    const corrected = await context.correctCategory(telegramUserId, transactionId!, categoryPrefix)
    return corrected
      ? texts.categoryCorrected(corrected.amountKopecks, corrected.categoryName, corrected.keyword)
      : texts.entryGone()
  }

  const removed = await context.deleteEntry(telegramUserId, transactionId!)
  return removed ? texts.entryDeleted(removed.amountKopecks) : texts.entryGone()
}

/**
 * A `/start` press is itself permission to write back: Telegram only delivers it
 * because the person opened the chat and tapped the button. That is the cheapest
 * and most reliable moment to learn that a chat is reachable.
 */
export async function routeUpdate(update: TelegramUpdate, context: RouterContext): Promise<RouterAction> {
  const callback = update.callback_query
  if (callback) {
    const chatId = callback.message?.chat?.id
    if (!Number.isSafeInteger(chatId)) return { kind: 'none' }
    const from = Number.isSafeInteger(callback.from?.id) ? callback.from!.id! : null
    const message = callback.data === 'help'
      ? texts.help(context.links)
      : await handleButton(callback.data ?? '', from, context)
    // A correction replaces the message it came from: the chat should not grow
    // by two messages every time somebody fixes a category.
    const replaceMessageId = callback.data?.startsWith('help') ? undefined : callback.message?.message_id
    return { kind: 'answer', callbackQueryId: callback.id, chatId: chatId!, message, replaceMessageId }
  }

  const message = update.message
  const chatId = message?.chat?.id
  // Groups are out of scope: a shared wallet is invited to, not chatted in.
  if (!message || !Number.isSafeInteger(chatId) || message.chat?.type !== 'private') return { kind: 'none' }
  if (message.from?.is_bot) return { kind: 'none' }

  const telegramUserId = Number.isSafeInteger(message.from?.id) ? message.from!.id! : null
  const send = (payload: BotMessage): RouterAction => ({ kind: 'send', chatId: chatId!, message: payload })

  const text = message.text?.trim()
  if (!text) {
    // Voice and receipt photos are what people try first, having seen other
    // finance bots take them. Silence would read as a broken bot.
    const attachment = message.voice || message.audio || message.photo || message.document || message.video_note
    return attachment ? send(texts.unsupportedAttachment()) : { kind: 'none' }
  }

  const invite = START_WITH_INVITE.exec(text)
  if (invite) {
    const resolved = await context.resolveInvite(invite[1]!)
    return send(resolved ? texts.accountInvite(resolved.accountName, resolved.url) : texts.accountInviteExpired())
  }

  const command = BARE_COMMAND.exec(text)?.[1]

  if (command === 'start') {
    const known = telegramUserId !== null ? (await context.noteBotContact(telegramUserId)).known : false
    return send(known ? texts.welcomeBack(context.links) : texts.welcome(context.links))
  }

  if (telegramUserId !== null) await context.noteBotContact(telegramUserId)

  if (command === 'help') return send(texts.help(context.links))
  if (command === 'app') return send(texts.welcomeBack(context.links))
  if (command) return send(texts.fallback(context.links))

  // Anything without a digit is conversation, not a failed expense: answering
  // "не нашёл сумму" to "привет" would be a non sequitur.
  if (!HAS_DIGIT.test(text) || telegramUserId === null) return send(texts.fallback(context.links))

  const parsed = parseQuickLine(text)
  if (parsed.status === 'rejected') return send(texts.notRecorded(parsed.reason))

  const outcome = await context.recordEntry(telegramUserId, parsed.amount, parsed.text)
  if (outcome.status === 'no-account') return send(texts.noAccountYet(context.links))
  if (outcome.status === 'failed') return send(texts.couldNotRecord())
  return send(confirmation(outcome.entry))
}
