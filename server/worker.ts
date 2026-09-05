import { createStore } from './store/index.js'
import { deliverDailyReminders } from './telegram/delivery.js'
import { botToken } from './telegram/api.js'

const store = await createStore()
try {
  const housekeeping = await store.runWorkerBatch()
  // Without a token there is nobody to send as, and every candidate would be
  // claimed and then released on a failure that is not going to resolve.
  const reminders = botToken()
    ? await deliverDailyReminders(store)
    : { sent: 0, skipped: 0, failed: 0, revoked: 0 }
  console.info(JSON.stringify({ event: 'worker_batch_complete', ...housekeeping, reminders }))
} finally {
  await store.close()
}
