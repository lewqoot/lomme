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

/** The same rendering the shortcut uses, so both confirmations read alike. */
export function money(amountKopecks: number) {
  return `${(amountKopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}

export function welcome(appUrl: string | null): BotMessage {
  return {
    text: [
      '👋 Привет! Я Lomme.',
      '',
      'Записываю траты и показываю, куда на самом деле уходят деньги. Никаких таблиц.',
      '',
      'Самое быстрое — напиши прямо сюда:',
      '1250 такси — и готово.',
      '',
      'А в приложении — аналитика, история и все настройки.',
    ].join('\n'),
    keyboard: [...openApp(appUrl), [HELP_BUTTON]],
  }
}

export function welcomeBack(appUrl: string | null): BotMessage {
  return {
    text: 'С возвращением 👋\n\nНапиши трату сюда или открой приложение.',
    keyboard: openApp(appUrl),
  }
}

export function help(appUrl: string | null): BotMessage {
  return {
    text: [
      'Как со мной работать',
      '',
      'Записать трату — напиши сумму и что это:',
      '1250 такси',
      'пятёрочка 2340',
      'кафе 890',
      '430 аптека',
      '',
      'Порядок не важен. Понимаю названия магазинов и сокращения, категорию подберу сам. Ошибусь — поправишь в приложении.',
      '',
      'Хочешь ещё быстрее? В приложении «Настройки» → «Быстрый ввод» ставит шорткат на экран блокировки — тогда Telegram открывать не надо совсем.',
      '',
      'Аналитика, кошельки и категории — тоже в приложении.',
    ].join('\n'),
    keyboard: openApp(appUrl),
  }
}

/** The category was chosen outright: the name is a statement, not a question. */
export function recorded(amountKopecks: number, categoryName: string): BotMessage {
  return { text: `✅ Записано ${money(amountKopecks)}\n${categoryName}` }
}

/**
 * The category was worked out from the text. Saying so once is cheaper than a
 * month of analytics quietly built on a wrong guess.
 */
export function recordedGuess(amountKopecks: number, categoryName: string): BotMessage {
  return { text: `✅ Записано ${money(amountKopecks)}\n${categoryName} — если не туда, поправь в приложении` }
}

export function recordedWithoutCategory(amountKopecks: number): BotMessage {
  return { text: `✅ Записано ${money(amountKopecks)}\nБез категории` }
}

export function amountNotFound(): BotMessage {
  return { text: '🤔 Не нашёл сумму\n\nНапиши так: 450 кофе или кофе 450' }
}

/** Written for someone who pressed the microphone because other bots take voice. */
export function unsupportedAttachment(): BotMessage {
  return {
    text: [
      'Голосовые и фото пока не разбираю — учусь.',
      '',
      'Напиши текстом: 340 кофе — так пойму сразу.',
    ].join('\n'),
  }
}

/** They messaged the bot before ever opening the Mini App, so there is no wallet. */
export function noAccountYet(appUrl: string | null): BotMessage {
  return {
    text: [
      'Похоже, ты ещё не открывал приложение.',
      '',
      'Открой Lomme — заведу кошелёк, и дальше можно писать траты прямо сюда.',
    ].join('\n'),
    keyboard: openApp(appUrl),
  }
}

export function couldNotRecord(): BotMessage {
  return { text: '⚠️ Не записалось\nПопробуй ещё раз' }
}

/**
 * The evening nudge. It is only ever sent to someone who recorded nothing
 * today, so it can assume there is nothing to report rather than nag.
 *
 * The line about switching it off appears in the first three only: after that
 * it is noise, and the setting has not moved.
 */
export function dailyReminder(deliveredBefore: number): BotMessage {
  const lines = [
    'Зашёл напомнить про траты 👋',
    '',
    'Напиши пару слов — 300 метро — и я запишу.',
  ]
  if (deliveredBefore < 3) {
    lines.push('', 'Время можно поменять или выключить напоминания в приложении, раздел «Уведомления».')
  }
  return { text: lines.join('\n') }
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

/** Text with no number in it at all: not a failed entry, just a hello. */
export function fallback(appUrl: string | null): BotMessage {
  return {
    text: [
      'Я записываю траты. Напиши сумму и что это — например, 450 кофе.',
      '',
      'Аналитика и всё остальное — в приложении.',
    ].join('\n'),
    keyboard: openApp(appUrl),
  }
}
