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
 * Where the bot's buttons can point. Both parts can be missing — a local run
 * has no https address, and the username is only known once the Bot API has
 * answered — and every builder below simply drops the buttons it cannot aim.
 */
export type LinkContext = { appUrl: string | null; botUsername: string | null }

function openApp({ appUrl }: LinkContext): InlineKeyboard {
  return appUrl ? [[{ text: 'Открыть Lomme', web_app: { url: appUrl } }]] : []
}

/**
 * A link into one screen of the Mini App. `startapp` values are the list the
 * client knows in `telegramLaunchTarget`; anything else lands on the home
 * screen, so the two sides have to be changed together.
 */
function screenLink({ botUsername }: LinkContext, screen: 'shortcut' | 'notifications' | 'family' | 'analytics', text: string) {
  return botUsername ? [{ text, url: `https://t.me/${botUsername}?startapp=${screen}&mode=fullscreen` }] : []
}

/** The same rendering the shortcut uses, so both confirmations read alike. */
export function money(amountKopecks: number) {
  return `${(amountKopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}

export function welcome(links: LinkContext): BotMessage {
  return {
    text: [
      '🙂 Привет! Я Lomme.',
      '',
      'Записываю траты и показываю, куда на самом деле уходят деньги. Никаких таблиц.',
      '',
      'Самое быстрое — напиши прямо сюда:',
      '1250 такси — и готово.',
      '',
      'А в приложении — аналитика, история и все настройки.',
    ].join('\n'),
    keyboard: [
      ...openApp(links),
      screenLink(links, 'shortcut', '⚡️ Записывать с экрана блокировки'),
      screenLink(links, 'notifications', '🔔 Напоминания'),
      [HELP_BUTTON],
    ].filter((row) => row.length),
  }
}

export function welcomeBack(links: LinkContext): BotMessage {
  return {
    text: '🙂 С возвращением\n\nНапиши трату сюда или открой приложение.',
    keyboard: openApp(links),
  }
}

export function help(links: LinkContext): BotMessage {
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
      'Порядок не важен. Понимаю названия магазинов и сокращения, категорию подберу сам. Ошибусь — нажми «Другая категория» под ответом, и я запомню это слово на будущее.',
      '',
      'Хочешь ещё быстрее? Шорткат ставит запись трат на экран блокировки — тогда Telegram открывать не надо совсем.',
      '',
      'Аналитика, кошельки и категории — тоже в приложении.',
    ].join('\n'),
    keyboard: [...openApp(links), screenLink(links, 'shortcut', '⚡️ Настроить шорткат')].filter((row) => row.length),
  }
}

/**
 * Buttons under a fresh entry. Telegram allows 64 bytes of callback data, so
 * the transaction id travels whole (36 characters) and nothing else has to.
 */
function entryButtons(transactionId: string, offerCategory: boolean): InlineKeyboard {
  const row: InlineKeyboard[number] = []
  if (offerCategory) row.push({ text: 'Другая категория', callback_data: `cat:${transactionId}` })
  row.push({ text: 'Удалить', callback_data: `del:${transactionId}` })
  return [row]
}

/** The category was chosen outright: the name is a statement, not a question. */
export function recorded(amountKopecks: number, categoryName: string, transactionId: string): BotMessage {
  return {
    text: `✔️ Записано ${money(amountKopecks)}\n${categoryName}`,
    keyboard: entryButtons(transactionId, true),
  }
}

/**
 * The category was worked out from the text. Saying so once is cheaper than a
 * month of analytics quietly built on a wrong guess.
 */
export function recordedGuess(amountKopecks: number, categoryName: string, transactionId: string): BotMessage {
  return {
    text: `✔️ Записано ${money(amountKopecks)}\n${categoryName} — если не туда, поправь`,
    keyboard: entryButtons(transactionId, true),
  }
}

export function recordedWithoutCategory(amountKopecks: number, transactionId: string): BotMessage {
  return {
    text: `✔️ Записано ${money(amountKopecks)}\nБез категории`,
    keyboard: [[
      { text: 'Выбрать категорию', callback_data: `cat:${transactionId}` },
      { text: 'Удалить', callback_data: `del:${transactionId}` },
    ]],
  }
}

/**
 * The category picker. Ids are shortened to eight characters to fit the
 * callback budget alongside the transaction id; the store refuses a prefix
 * that matches more than one category rather than guessing.
 */
export function chooseCategory(transactionId: string, categories: Array<{ id: string; name: string }>, currentCategoryId: string | null): BotMessage {
  const rows: InlineKeyboard = []
  const offered = categories.filter((item) => item.id !== currentCategoryId)
  for (let index = 0; index < offered.length; index += 2) {
    rows.push(offered.slice(index, index + 2).map((item) => ({
      text: item.name,
      callback_data: `set:${transactionId}:${item.id.slice(0, 8)}`,
    })))
  }
  rows.push([{ text: '← Оставить как есть', callback_data: `keep:${transactionId}` }])
  return { text: 'Куда записать?', keyboard: rows }
}

/** After a correction: says what changed, and what was learned from it. */
export function categoryCorrected(amountKopecks: number, categoryName: string, keyword: string | null): BotMessage {
  const lines = [`✔️ ${money(amountKopecks)} → ${categoryName}`]
  if (keyword) lines.push('', `Запомнил: «${keyword}» теперь идёт сюда.`)
  return { text: lines.join('\n') }
}

export function entryDeleted(amountKopecks: number): BotMessage {
  return { text: `🗑 Удалил запись на ${money(amountKopecks)}` }
}

/** The button outlived the entry it belonged to. */
export function entryGone(): BotMessage {
  return { text: 'Этой записи уже нет.' }
}

export function amountNotFound(): BotMessage {
  return { text: '❓ Не нашёл сумму\n\nНапиши так: 450 кофе или кофе 450' }
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
export function noAccountYet(links: LinkContext): BotMessage {
  return {
    text: [
      'Похоже, ты ещё не открывал приложение.',
      '',
      'Открой Lomme — заведу кошелёк, и дальше можно писать траты прямо сюда.',
    ].join('\n'),
    keyboard: openApp(links),
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
    '🔔 Зашёл напомнить про траты',
    '',
    'Напиши пару слов — 300 метро — и я запишу.',
  ]
  if (deliveredBefore < 3) {
    lines.push('', 'Время можно поменять или выключить напоминания в приложении, раздел «Уведомления».')
  }
  return { text: lines.join('\n') }
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

type DigestCategory = { name: string; amountKopecks: number }

/**
 * Sunday's wrap-up. It leads with the number and only then explains it, and the
 * comparison line appears only when there is a comparable week behind it —
 * "на 100% меньше, чем на прошлой неделе" is what a bot says when it has
 * nothing to say.
 */
export function weeklyDigest(input: {
  expenseKopecks: number
  previousExpenseKopecks: number | null
  top: DigestCategory[]
}): BotMessage {
  const lines = ['📊 Неделя закрыта', '']
  const difference = input.previousExpenseKopecks === null ? null : input.expenseKopecks - input.previousExpenseKopecks
  if (difference === null || difference === 0) {
    lines.push(`Потратил ${money(input.expenseKopecks)}.`)
  } else {
    const shape = difference < 0 ? 'меньше' : 'больше'
    lines.push(`Потратил ${money(input.expenseKopecks)} — на ${money(Math.abs(difference))} ${shape}, чем неделей раньше.`)
  }
  const leader = input.top[0]
  if (leader) lines.push('', `Больше всего ушло на ${leader.name}: ${money(leader.amountKopecks)}.`)
  return { text: lines.join('\n') }
}

/** The month that just ended, in the three numbers people actually look for. */
export function monthlyDigest(input: {
  year: number
  month: number
  incomeKopecks: number
  expenseKopecks: number
  netKopecks: number
  top: DigestCategory[]
}): BotMessage {
  const name = MONTH_NAMES[input.month - 1] ?? ''
  const lines = [
    `🗓 ${name} закрыт`,
    '',
    `Доходы  ${money(input.incomeKopecks)}`,
    `Расходы  ${money(input.expenseKopecks)}`,
    input.netKopecks < 0
      ? `Ушли в минус на ${money(Math.abs(input.netKopecks))}`
      : `Осталось  ${money(input.netKopecks)}`,
  ]
  if (input.top.length) {
    lines.push('', `Больше всего: ${input.top.map((item) => `${item.name} ${money(item.amountKopecks)}`).join(', ')}.`)
  }
  return { text: lines.join('\n') }
}

/**
 * The one-off messages. Each asks for the smallest next step rather than
 * "зайди в приложение", because the step is what was missing.
 */
export function reactivation(kind: 'start-day1' | 'start-day3' | 'return' | 'tip-shortcut' | 'tip-family', links: LinkContext): BotMessage {
  if (kind === 'start-day1') {
    return {
      text: [
        '👀 Ты завёл Lomme, но записей пока нет',
        '',
        'Начать проще всего отсюда: напиши 1250 такси — покажу, как это выглядит.',
      ].join('\n'),
    }
  }
  if (kind === 'start-day3') {
    return {
      text: [
        'Одна трата в день — и через неделю ты увидишь, куда деньги уходят на самом деле.',
        '',
        'Давай прямо сейчас: сумма и пара слов.',
      ].join('\n'),
    }
  }
  if (kind === 'return') {
    return {
      text: [
        '👀 Давно тебя не было',
        '',
        'За неделю ничего не записалось. Если хочешь, начнём с сегодняшнего дня — просто напиши трату.',
      ].join('\n'),
    }
  }
  if (kind === 'tip-shortcut') {
    return {
      text: [
        '⚡️ Хочешь записывать за две секунды?',
        '',
        'Шорткат ставит запись трат прямо на экран блокировки — не надо даже открывать Telegram.',
      ].join('\n'),
      keyboard: screenRow(links, 'shortcut', 'Настроить шорткат'),
    }
  }
  return {
    text: [
      '🏠 Ведёшь бюджет не один?',
      '',
      'Общий кошелёк — это когда траты видят все участники, и сразу понятно, кто что записал. Удобно для семьи или пары.',
    ].join('\n'),
    keyboard: screenRow(links, 'family', 'Позвать в общий кошелёк'),
  }
}

function screenRow(links: LinkContext, screen: 'shortcut' | 'family', text: string): InlineKeyboard {
  const row = screenLink(links, screen, text)
  return row.length ? [row] : []
}

export function accountInvite(accountName: string, inviteUrl: string): BotMessage {
  return {
    text: [
      `✉️ Тебя зовут в общий кошелёк «${accountName}»`,
      '',
      'Записи будут видны всем участникам.',
    ].join('\n'),
    keyboard: [[{ text: 'Открыть приглашение', url: inviteUrl }]],
  }
}

/** Told to the person who sent the invite, once it is actually used. */
export function accountInviteAccepted(memberName: string, accountName: string): BotMessage {
  return { text: `🎉 ${memberName} присоединился к кошельку «${accountName}»` }
}

/**
 * What the other people in a shared wallet put in today. Sent instead of the
 * evening reminder, never alongside it: one message a night is the rule.
 */
export function sharedWalletDigest(accountName: string, byAuthor: Array<{ name: string; count: number; amountKopecks: number }>): BotMessage {
  const entries = (count: number) => {
    const tail = count % 100 >= 11 && count % 100 <= 14 ? 'записей' : ['записей', 'запись', 'записи', 'записи', 'записи'][Math.min(count % 10, 4)] ?? 'записей'
    return `${count} ${tail}`
  }
  return {
    text: [
      `🏠 Сегодня в «${accountName}»`,
      '',
      ...byAuthor.map((item) => `${item.name} — ${entries(item.count)} на ${money(item.amountKopecks)}`),
    ].join('\n'),
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
export function fallback(links: LinkContext): BotMessage {
  return {
    text: [
      'Я записываю траты. Напиши сумму и что это — например, 450 кофе.',
      '',
      'Аналитика и всё остальное — в приложении.',
    ].join('\n'),
    keyboard: openApp(links),
  }
}
