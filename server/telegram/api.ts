/**
 * The only place that talks to the Bot API.
 *
 * Everything else builds a message and hands it here, so a blocked user, a rate
 * limit or a network failure is recognised once rather than at every call site.
 */

import { leadingEmojiEntities } from './custom-emoji.js'

export type InlineButton =
  | { text: string; url: string }
  | { text: string; web_app: { url: string } }
  | { text: string; callback_data: string }

export type InlineKeyboard = InlineButton[][]

export type BotMessage = { text: string; keyboard?: InlineKeyboard }

export type SendOutcome =
  | { ok: true; messageId: number }
  /** The user blocked the bot or the chat is gone: never worth retrying. */
  | { ok: false; permanent: true; description: string }
  /** Rate limited or a transient failure: `retryAfter` is seconds when known. */
  | { ok: false; permanent: false; description: string; retryAfter?: number }

type ApiResponse<T> = {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

const API_ORIGIN = 'https://api.telegram.org'

export function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
}

/**
 * A 403 means the person removed the bot, and 400 "chat not found" means the
 * chat no longer exists. Both are settled answers, so the caller stops writing
 * to that chat instead of retrying a message that can never arrive.
 */
function isPermanent(status: number, description: string) {
  if (status === 403) return true
  return status === 400 && /chat not found|user is deactivated|bot was blocked|message to edit not found|message can't be edited/i.test(description)
}

async function call<T>(method: string, payload: unknown): Promise<ApiResponse<T> & { status: number }> {
  const token = botToken()
  if (!token) return { ok: false, status: 0, description: 'TELEGRAM_BOT_TOKEN is not set' }
  const response = await fetch(`${API_ORIGIN}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({ ok: false })) as ApiResponse<T>
  return { ...body, status: response.status }
}

export async function sendMessage(chatId: number, message: BotMessage): Promise<SendOutcome> {
  const entities = leadingEmojiEntities(message.text)
  const result = await call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: message.text,
    // Texts are written as plain text on purpose: no parse mode means no
    // escaping rules to get wrong when a wallet or category name contains
    // a character Telegram would otherwise read as markup. Animated emoji are
    // attached as entities for the same reason — HTML would reintroduce it.
    ...(entities.length ? { entities } : {}),
    ...(message.keyboard ? { reply_markup: { inline_keyboard: message.keyboard } } : {}),
  })
  if (result.ok && result.result) return { ok: true, messageId: result.result.message_id }
  const description = result.description || `HTTP ${result.status}`
  if (isPermanent(result.status, description)) return { ok: false, permanent: true, description }
  return { ok: false, permanent: false, description, retryAfter: result.parameters?.retry_after }
}

/**
 * Replaces the message a button was attached to, so the chat does not grow.
 *
 * The message can be gone — deleted by the reader, or too old for Telegram to
 * edit — and that is a settled answer, not something to retry. Callers fall
 * back to sending a new message so the answer still arrives.
 */
export async function editMessage(chatId: number, messageId: number, message: BotMessage): Promise<SendOutcome> {
  const entities = leadingEmojiEntities(message.text)
  const result = await call<{ message_id: number }>('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: message.text,
    ...(entities.length ? { entities } : {}),
    ...(message.keyboard ? { reply_markup: { inline_keyboard: message.keyboard } } : {}),
  })
  if (result.ok && result.result) return { ok: true, messageId: result.result.message_id }
  const description = result.description || `HTTP ${result.status}`
  if (isPermanent(result.status, description)) return { ok: false, permanent: true, description }
  return { ok: false, permanent: false, description }
}

/** Clears the spinner Telegram shows on a tapped inline button. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
}

/** The bot's own username, for deep links built outside a request. */
export function botUsernameFromEnv() {
  const value = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
  return value && /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : null
}

export async function setMyCommands(commands: Array<{ command: string; description: string }>) {
  const result = await call('setMyCommands', { commands, scope: { type: 'all_private_chats' }, language_code: 'ru' })
  return Boolean(result.ok)
}

/**
 * Which update types Telegram actually delivers. A webhook registered without
 * `callback_query` silently drops every inline-button press: the button spins
 * and nothing arrives, with no error anywhere to explain it.
 */
export async function webhookAllowedUpdates(): Promise<string[] | null> {
  const result = await call<{ allowed_updates?: string[]; url?: string }>('getWebhookInfo', {})
  if (!result.ok || !result.result?.url) return null
  // An empty list means Telegram's own default, which excludes callback_query.
  return result.result.allowed_updates ?? []
}

export async function setChatMenuButton(appUrl: string, label: string) {
  const result = await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: label, web_app: { url: appUrl } },
  })
  return Boolean(result.ok)
}
