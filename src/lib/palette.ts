import { DATA_COLORS } from '../shared/design-tokens.js'

/**
 * A category stores one saturated colour. The glyph uses it directly and the tile
 * behind the glyph is that colour mixed a quarter of the way over white - the ratio
 * measured off the reference screenshots (within ~6/255 per channel).
 */
const TINT_RATIO = 0.25

export function tint(color: string | undefined, ratio = TINT_RATIO): string {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return DATA_COLORS.tileFallback
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16)
    return Math.round(value * ratio + 255 * (1 - ratio))
  }
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, '0')).join('')}`
}
