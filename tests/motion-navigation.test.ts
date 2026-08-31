import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8')

function keyframeBlocks(source: string) {
  const blocks: string[] = []
  let start = source.indexOf('@keyframes')
  while (start >= 0) {
    const opening = source.indexOf('{', start)
    let depth = 0
    let end = opening
    for (; end < source.length; end++) {
      if (source[end] === '{') depth += 1
      if (source[end] === '}' && --depth === 0) break
    }
    blocks.push(source.slice(start, end + 1))
    start = source.indexOf('@keyframes', end + 1)
  }
  return blocks
}

describe('motion and navigation guardrails', () => {
  it('uses one 240 ms navigation hand-off that a later tap can replace', () => {
    expect(app).toContain('const NAVIGATION_DURATION_MS = 240')
    expect(app).not.toContain("navigationMotion.startsWith('exit')")
    expect(app).toMatch(/setPage\(next\)[\s\S]*?setNavigationMotion\([\s\S]*?setTimeout\([\s\S]*?NAVIGATION_DURATION_MS/)
    expect(settings).toContain('const SETTINGS_NAVIGATION_DURATION_MS = 240')
    expect(settings).not.toContain('screenClosing')
    expect(settings).toContain("move('root', 'return')")
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.motion-enter-home > \.home-layer/)
  })

  it('limits animated CSS to transform and opacity', () => {
    const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map(([, value]) => value)
    expect(transitions.join('\n')).not.toMatch(/\b(?:width|height|min-height|max-width|margin|padding|border-radius|flex-basis|background|border-color|color|filter)\b/)

    const keyframes = keyframeBlocks(css)
    expect(keyframes.join('\n')).not.toMatch(/\b(?:width|height|min-height|max-width|margin|padding|border-radius|background-position|stroke-dashoffset)\b/)
  })

  it('keeps the pull, carousel, toggle, bars, and swipe reveal composited', () => {
    expect(css).toContain('--motion-screen: 240ms')
    expect(css).not.toMatch(/\.category-carousel button\s*\{[^}]*\b(?:width|height|flex-basis)\s*\./s)
    expect(css).toMatch(/\.fake-toggle\.on b\s*\{\s*transform:\s*translateX\(20px\)/)
    expect(css).toMatch(/\.analytics-bar\s*\{[\s\S]*?scaleX\(var\(--bar, 0\)\)/)
    expect(css).toMatch(/\.operation-delete::before\s*\{[\s\S]*?scaleX\(var\(--swipe-progress, 0\)\)/)
    expect(app).toContain("'--swipe-progress': Math.min(offset / 92, 1)")
  })
})
