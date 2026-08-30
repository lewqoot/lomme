// Zero-dependency static server for the deployed design preview.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT) || 8080

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'cache-control': 'no-cache', ...headers })
  response.end(body)
}

createServer(async (request, response) => {
  if (request.url === '/healthz') return send(response, 200, 'ok', { 'content-type': 'text/plain' })

  // Resolve inside ROOT only; anything unresolved falls back to the SPA entry.
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  let file = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(ROOT)) file = join(ROOT, 'index.html')

  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(ROOT, 'index.html')
  }

  try {
    const body = await readFile(file)
    const type = TYPES[extname(file)] || 'application/octet-stream'
    const immutable = file.includes('/assets/') || file.includes('/fonts/')
    send(response, 200, body, {
      'content-type': type,
      ...(immutable ? { 'cache-control': 'public, max-age=31536000, immutable' } : {}),
    })
  } catch {
    send(response, 404, 'Not found', { 'content-type': 'text/plain' })
  }
}).listen(PORT, '::', () => console.log(`design preview on :${PORT}`))
