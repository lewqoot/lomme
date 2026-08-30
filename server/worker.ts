import { createStore } from './store/index.js'

const store = await createStore()
try {
  const result = await store.runWorkerBatch()
  console.info(JSON.stringify({ event: 'worker_batch_complete', ...result }))
} finally {
  await store.close()
}
