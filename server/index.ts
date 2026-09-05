import { buildApp } from './app.js'
import { createStore } from './store/index.js'
import { botToken, setChatMenuButton, setMyCommands } from './telegram/api.js'
import { BOT_COMMANDS, MENU_BUTTON_LABEL } from './telegram/texts.js'

const store = await createStore()
const app = await buildApp(store)
const port = Number(process.env.PORT || 3000)

/**
 * The command list and the menu button live on Telegram's side, not ours, so
 * they are re-declared on every boot. Both calls are idempotent and neither is
 * allowed to hold up or fail the start: the bot still answers without them.
 */
async function registerBotMenu() {
  if (!botToken()) return
  const appUrl = process.env.APP_URL?.trim()
  try {
    await setMyCommands(BOT_COMMANDS)
    if (appUrl?.startsWith('https://')) await setChatMenuButton(appUrl, MENU_BUTTON_LABEL)
  } catch (error) {
    app.log.error({ event: 'telegram_menu_registration_failed', error: error instanceof Error ? error.message : 'unknown' })
  }
}

try {
  await app.listen({ host: '0.0.0.0', port })
  void registerBotMenu()
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
