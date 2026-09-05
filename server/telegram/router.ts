/**
 * Turns one Telegram update into at most one reply.
 *
 * The router itself performs no network calls and reads no environment beyond
 * what it is handed, so every branch below is testable without a live bot.
 */

import type { BotMessage } from './api.js'
import * as texts from './texts.js'

export type TelegramUpdate = {
  update_id?: number
  message?: {
    text?: string
    chat?: { id?: number; type?: string }
    from?: { id?: number; is_bot?: boolean }
  }
  callback_query?: {
    id: string
    data?: string
    from?: { id?: number }
    message?: { chat?: { id?: number }; message_id?: number }
  }
}

export type RouterContext = {
  appUrl: string | null
  /** Marks the chat as reachable and reports whether this person is already a user. */
  noteBotContact(telegramUserId: number): Promise<{ known: boolean }>
  /** Resolves an invite token into a wallet name and its deep link. */
  resolveInvite(token: string): Promise<{ accountName: string; url: string } | null>
}

export type RouterAction =
  | { kind: 'none' }
  | { kind: 'send'; chatId: number; message: BotMessage }
  | { kind: 'answer'; callbackQueryId: string; chatId: number; message: BotMessage }

const START_WITH_INVITE = /^\/start(?:@[A-Za-z0-9_]+)?\s+invite_([A-Za-z0-9_-]{20,120})$/
const BARE_COMMAND = /^\/([a-z_]{1,32})(?:@[A-Za-z0-9_]+)?$/

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
    if (callback.data === 'help') {
      return { kind: 'answer', callbackQueryId: callback.id, chatId: chatId!, message: texts.help(context.appUrl) }
    }
    return { kind: 'answer', callbackQueryId: callback.id, chatId: chatId!, message: texts.fallback(context.appUrl) }
  }

  const message = update.message
  const chatId = message?.chat?.id
  const text = message?.text?.trim()
  // Groups are out of scope: a shared wallet is invited to, not chatted in.
  if (!text || !Number.isSafeInteger(chatId) || message?.chat?.type !== 'private') return { kind: 'none' }
  if (message?.from?.is_bot) return { kind: 'none' }

  const invite = START_WITH_INVITE.exec(text)
  if (invite) {
    const resolved = await context.resolveInvite(invite[1]!)
    return {
      kind: 'send',
      chatId: chatId!,
      message: resolved ? texts.accountInvite(resolved.accountName, resolved.url) : texts.accountInviteExpired(),
    }
  }

  const command = BARE_COMMAND.exec(text)?.[1]
  const telegramUserId = message?.from?.id

  if (command === 'start') {
    const known = Number.isSafeInteger(telegramUserId)
      ? (await context.noteBotContact(telegramUserId!)).known
      : false
    return {
      kind: 'send',
      chatId: chatId!,
      message: known ? texts.welcomeBack(context.appUrl) : texts.welcome(context.appUrl),
    }
  }

  if (Number.isSafeInteger(telegramUserId)) await context.noteBotContact(telegramUserId!)

  if (command === 'help') return { kind: 'send', chatId: chatId!, message: texts.help(context.appUrl) }
  if (command === 'app') return { kind: 'send', chatId: chatId!, message: texts.welcomeBack(context.appUrl) }

  return { kind: 'send', chatId: chatId!, message: texts.fallback(context.appUrl) }
}
