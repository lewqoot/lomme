/**
 * Turns one Telegram update into at most one reply.
 *
 * The router itself performs no network calls and reads no environment beyond
 * what it is handed, so every branch below is testable without a live bot.
 */

import { splitQuickInput } from '../../src/shared/quick-entry.js'
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
  appUrl: string | null
  /** Marks the chat as reachable and reports whether this person is already a user. */
  noteBotContact(telegramUserId: number): Promise<{ known: boolean }>
  /** Resolves an invite token into a wallet name and its deep link. */
  resolveInvite(token: string): Promise<{ accountName: string; url: string } | null>
  /** Records one line of free text as an expense. */
  recordEntry(telegramUserId: number, amount: string, text: string): Promise<RecordOutcome>
}

export type RouterAction =
  | { kind: 'none' }
  | { kind: 'send'; chatId: number; message: BotMessage }
  | { kind: 'answer'; callbackQueryId: string; chatId: number; message: BotMessage }

const START_WITH_INVITE = /^\/start(?:@[A-Za-z0-9_]+)?\s+invite_([A-Za-z0-9_-]{20,120})$/
const BARE_COMMAND = /^\/([a-z_]{1,32})(?:@[A-Za-z0-9_]+)?$/
const HAS_DIGIT = /\d/

function confirmation(entry: RecordedEntry): BotMessage {
  if (!entry.categoryName) return texts.recordedWithoutCategory(entry.amountKopecks)
  return entry.categoryGuessed
    ? texts.recordedGuess(entry.amountKopecks, entry.categoryName)
    : texts.recorded(entry.amountKopecks, entry.categoryName)
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
    const message = callback.data === 'help' ? texts.help(context.appUrl) : texts.fallback(context.appUrl)
    return { kind: 'answer', callbackQueryId: callback.id, chatId: chatId!, message }
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
    return send(known ? texts.welcomeBack(context.appUrl) : texts.welcome(context.appUrl))
  }

  if (telegramUserId !== null) await context.noteBotContact(telegramUserId)

  if (command === 'help') return send(texts.help(context.appUrl))
  if (command === 'app') return send(texts.welcomeBack(context.appUrl))
  if (command) return send(texts.fallback(context.appUrl))

  // Anything without a digit is conversation, not a failed expense: answering
  // "не нашёл сумму" to "привет" would be a non sequitur.
  if (!HAS_DIGIT.test(text) || telegramUserId === null) return send(texts.fallback(context.appUrl))

  const split = splitQuickInput(text)
  if (!split) return send(texts.amountNotFound())

  const outcome = await context.recordEntry(telegramUserId, split.amount, split.text)
  if (outcome.status === 'no-account') return send(texts.noAccountYet(context.appUrl))
  if (outcome.status === 'failed') return send(texts.couldNotRecord())
  return send(confirmation(outcome.entry))
}
