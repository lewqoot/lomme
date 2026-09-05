import { execFileSync } from 'node:child_process'

const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim()
if (status) {
  console.error('Release refused: the Git working tree is not clean.')
  console.error(status)
  process.exit(1)
}

console.info('Release tree is clean.')
