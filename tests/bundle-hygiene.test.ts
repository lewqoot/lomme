import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const designConfig = readFileSync(new URL('../vite.design.config.ts', import.meta.url), 'utf8')
const chunks = readFileSync(new URL('../scripts/manual-chunks.ts', import.meta.url), 'utf8')

describe('bundle hygiene', () => {
  it('names the lazy Recharts chunk in both builds', () => {
    expect(chunks).toContain("return 'recharts'")
    expect(config).toContain('output: { manualChunks }')
    expect(designConfig).toContain('output: { manualChunks }')
    expect(app).toContain("const loadInsightsChart = () => import('./charts/InsightsChart')")
    expect(app).toContain("const loadAnalyticsChart = () => import('./charts/AnalyticsChart')")
  })

  it('uses the inline SVG gift and ships no Lottie runtime or asset', () => {
    expect(app).toContain('className={`gift-mark${finish ? \' finishing\' : \'\'}`}')
    expect(app).not.toContain('lottie-web')
    expect(app).not.toContain("pull-gift.json")
    expect(existsSync(new URL('../src/assets/pull-gift.json', import.meta.url))).toBe(false)
  })
})
