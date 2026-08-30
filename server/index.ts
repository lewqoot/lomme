import { buildApp } from './app.js'
import { createStore } from './store/index.js'

const store = await createStore()
const app = await buildApp(store)
const port = Number(process.env.PORT || 3000)

try {
  await app.listen({ host: '0.0.0.0', port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
