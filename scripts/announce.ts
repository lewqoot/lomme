/**
 * Sends one announcement to everyone the bot may write to.
 *
 * Run against production data, by hand, with no schedule behind it — so the
 * defaults are the cautious ones: it prints who would receive what and stops.
 * Nothing leaves the machine until `--send` is passed.
 *
 *   npx tsx scripts/announce.ts announcement.txt
 *   npx tsx scripts/announce.ts announcement.txt --send
 *
 * The first line of the file is the heading; if it opens with an emoji the set
 * knows, it arrives animated like any other heading.
 */

import { readFileSync } from 'node:fs'
import { createStore } from '../server/store/index.js'
import { botToken, sendMessage } from '../server/telegram/api.js'

/** Telegram allows about 30 messages a second; this stays well under it. */
const PACING_MS = 50

async function main() {
  const [file, ...flags] = process.argv.slice(2)
  const send = flags.includes('--send')
  if (!file) {
    console.error('Укажите файл с текстом: npx tsx scripts/announce.ts announcement.txt [--send]')
    process.exit(1)
  }

  const text = readFileSync(file, 'utf8').trim()
  if (!text) {
    console.error('Файл пуст — нечего отправлять.')
    process.exit(1)
  }
  if (text.length > 4096) {
    console.error(`Текст длиннее лимита Telegram: ${text.length} символов из 4096.`)
    process.exit(1)
  }
  if (send && !botToken()) {
    console.error('Нет TELEGRAM_BOT_TOKEN — отправлять нечем.')
    process.exit(1)
  }

  const store = await createStore()
  try {
    const recipients = await store.announcementRecipients()
    console.log('--- текст ---')
    console.log(text)
    console.log('--- получатели ---')
    console.log(`${recipients.length} чел. (только те, кто разрешил боту писать)`)

    if (!send) {
      console.log('\nЭто предпросмотр. Чтобы отправить, добавьте --send')
      return
    }

    let sent = 0
    let revoked = 0
    let failed = 0
    for (const recipient of recipients) {
      const outcome = await sendMessage(recipient.telegramUserId, { text })
      if (outcome.ok) sent += 1
      else if (outcome.permanent) {
        // They blocked the bot: stop counting them as reachable.
        await store.revokeBotWriteAccess(recipient.telegramUserId)
        revoked += 1
      } else {
        failed += 1
        console.error(`не доставлено ${recipient.telegramUserId}: ${outcome.description}`)
      }
      const pause = !outcome.ok && !outcome.permanent && outcome.retryAfter
        ? Math.min(outcome.retryAfter, 30) * 1000
        : PACING_MS
      await new Promise((resolve) => { setTimeout(resolve, pause) })
    }
    console.log(`\nотправлено ${sent}, отписалось ${revoked}, не дошло ${failed}`)
  } finally {
    await store.close()
  }
}

await main()
