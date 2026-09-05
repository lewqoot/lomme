import { createStore } from './store/index.js'
import { runDeliveries } from './telegram/delivery.js'
import { botToken, botUsernameFromEnv } from './telegram/api.js'

const store = await createStore()
try {
  const housekeeping = await store.runWorkerBatch()
  // Without a token there is nobody to send as, and every candidate would be
  // claimed and then released on a failure that is not going to resolve.
  // The worker has no request to read an address from, so links come from the
  // same variables the web service uses.
  const appUrl = process.env.APP_URL?.trim()
  const links = {
    appUrl: appUrl?.startsWith('https://') ? appUrl : null,
    botUsername: botUsernameFromEnv(),
  }
  const reminders = botToken()
    ? await runDeliveries(store, new Date(), links)
    : { sent: 0, skipped: 0, failed: 0, revoked: 0 }
  console.info(JSON.stringify({ event: 'worker_batch_complete', ...housekeeping, reminders }))
} finally {
  await store.close()
}
