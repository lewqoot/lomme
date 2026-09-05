/**
 * Every word the bot says, in one file.
 *
 * The voice matches the shortcut replies in `shortcutErrorText`: second person
 * singular, two or three short lines, no honorifics. Buttons are only offered
 * for destinations that actually exist today — a button that opens the wrong
 * screen is worse than no button.
 */

import type { BotMessage, InlineKeyboard } from './api.js'

/** Shown on the button beside the message input. */
export const MENU_BUTTON_LABEL = 'Lomme'

export const BOT_COMMANDS = [
  { command: 'app', description: 'открыть Lomme' },
  { command: 'help', description: 'как это работает' },
]

const HELP_BUTTON = { text: 'Как это работает', callback_data: 'help' } as const

/**
 * Telegram rejects a web_app button whose url is not https, which is every
 * local run. Callers pass null there and the message goes out without it.
 */
function openApp(appUrl: string | null): InlineKeyboard {
  return appUrl ? [[{ text: 'Открыть Lomme', web_app: { url: appUrl } }]] : []
}

export function welcome(appUrl: string | null): BotMessage {
  return {
    text: [
      '👋 Привет! Я Lomme.',
      '',
      'Помогаю вести траты и доходы и показываю, куда на самом деле уходят деньги. Никаких таблиц.',
      '',
      'Всё живёт в приложении: записи, аналитика, кошельки и категории. Открывай кнопкой ниже.',
    ].join('\n'),
    keyboard: [...openApp(appUrl), [HELP_BUTTON]],
  }
}

export function welcomeBack(appUrl: string | null): BotMessage {
  return {
    text: 'С возвращением 👋',
    keyboard: openApp(appUrl),
  }
}

export function help(appUrl: string | null): BotMessage {
  return {
    text: [
      'Как со мной работать',
      '',
      'Записи, аналитика, кошельки и категории — в приложении. Открывай кнопкой ниже или через меню слева от поля ввода.',
      '',
      'Хочешь записывать траты за пару секунд, не открывая Telegram? В приложении зайди в «Настройки» → «Быстрый ввод» и поставь шорткат на экран блокировки.',
      '',
      'Ещё я приношу сюда приглашения в общие кошельки — их присылают те, кто зовёт тебя вести бюджет вместе.',
    ].join('\n'),
    keyboard: openApp(appUrl),
  }
}

export function accountInvite(accountName: string, inviteUrl: string): BotMessage {
  return {
    text: [
      `🤝 Тебя зовут в общий кошелёк «${accountName}»`,
      '',
      'Записи будут видны всем участникам.',
    ].join('\n'),
    keyboard: [[{ text: 'Открыть приглашение', url: inviteUrl }]],
  }
}

export function accountInviteExpired(): BotMessage {
  return {
    text: [
      'Это приглашение уже не работает — истекло или его отозвали.',
      '',
      'Попроси новую ссылку у того, кто звал.',
    ].join('\n'),
  }
}

/** Anything the bot has no answer for yet. Says what it can do instead. */
export function fallback(appUrl: string | null): BotMessage {
  return {
    text: [
      'Пока я умею немного: открываю приложение и приношу приглашения в общие кошельки.',
      '',
      'Всё остальное — в приложении.',
    ].join('\n'),
    keyboard: openApp(appUrl),
  }
}
