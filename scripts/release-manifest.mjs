import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name)
      return entry.isDirectory() ? filesBelow(absolute) : [absolute]
    })
    .sort()
}

function hashDirectory(relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  if (!statSync(directory).isDirectory()) throw new Error(`${relativeDirectory} is not a directory`)
  const hash = createHash('sha256')
  for (const file of filesBelow(directory)) {
    hash.update(path.relative(directory, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function releaseSha() {
  const explicit = process.env.RELEASE_SHA?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GITHUB_SHA?.trim()
  return explicit || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const journal = JSON.parse(readFileSync(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'))
const schemaEntries = journal.entries ?? []
const serverBundleSha256 = hashDirectory('dist-server')

const manifest = {
  formatVersion: 1,
  release: {
    sha: releaseSha(),
    appVersion: packageJson.version,
    packageManager: packageJson.packageManager,
  },
  schema: {
    version: schemaEntries.at(-1)?.tag ?? 'unknown',
    migrations: schemaEntries.length,
  },
  bundles: {
    web: { directory: 'dist', sha256: hashDirectory('dist') },
    server: { directory: 'dist-server', sha256: serverBundleSha256 },
  },
  roles: {
    api: { entrypoint: 'dist-server/server/index.js', sha: releaseSha(), bundleSha256: serverBundleSha256 },
    worker: { entrypoint: 'dist-server/server/worker.js', sha: releaseSha(), bundleSha256: serverBundleSha256 },
  },
}

mkdirSync(path.join(root, 'dist-release'), { recursive: true })
writeFileSync(path.join(root, 'dist-release/release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.info(JSON.stringify(manifest, null, 2))
