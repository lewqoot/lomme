import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

describe('дизайн-токены', () => {
  it('держит сырые цвета только в центральном реестре', () => {
    const start = css.indexOf('/* Central measured primitives.')
    const end = css.indexOf('/* Semantic money and state roles.', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const withoutRegistry = `${css.slice(0, start)}${css.slice(end)}`
    expect(withoutRegistry.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).toEqual([])
  })

  it('не возвращает неоднозначные orange/green токены', () => {
    expect(css).not.toMatch(/--orange\b|--green\b/)
    expect(css).toContain('--expense:')
    expect(css).toContain('--income:')
    expect(css).toContain('--danger:')
  })

  it('использует шкалу для размеров и насыщенности текста', () => {
    const afterTokens = css.slice(css.indexOf('/* No screen may push'))
    expect(afterTokens).not.toMatch(/font-size:\s*(?:\d|clamp\()/)
    expect(afterTokens).not.toMatch(/font-weight:\s*\d+\s*;/)
  })
})
