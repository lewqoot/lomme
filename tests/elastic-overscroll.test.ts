import { describe, expect, it } from 'vitest'
import { elasticOffset, elasticScale } from '../src/features/motion/useElasticOverscroll.js'

describe('упругая граница скролла', () => {
  it('даёт заметный ход в начале и наращивает сопротивление', () => {
    expect(elasticOffset(0)).toBe(0)
    expect(elasticOffset(24)).toBeGreaterThan(10)
    expect(elasticOffset(240)).toBeLessThanOrEqual(52)
    expect(elasticOffset(480) - elasticOffset(240)).toBeLessThan(4)
  })

  it('ограничивает растяжение экрана', () => {
    expect(elasticScale(0)).toBe(1)
    expect(elasticScale(24, 874)).toBeGreaterThan(1)
    expect(elasticScale(100, 874)).toBe(1.022)
  })
})
