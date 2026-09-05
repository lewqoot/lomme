/**
 * Animated emoji used by the bot in messages and inline buttons.
 *
 * Telegram renders a `custom_emoji` entity as the animated sticker for anyone
 * with Premium and falls back to the ordinary character underneath for
 * everyone else. That is why the map is keyed by the plain emoji: the text
 * stays readable on its own, and the entity is decoration laid over it.
 *
 * Ids come from the "NewsEmoji" set and were read back through
 * `getStickerSet`. They are stable identifiers, not URLs — if the set is ever
 * replaced, every id here has to be re-read, which is why they live in one
 * file rather than being sprinkled through the texts.
 *
 * The set does not contain exact twins for every emoji the first version used.
 * Texts use the closest NewsEmoji alternative instead, so an emoji never falls
 * back to the platform's standard artwork inside the bot chat.
 */

/** Plain emoji → id of its animated twin in the set. */
const ANIMATED: Readonly<Record<string, string>> = {
  '👀': '5210956306952758910',
  '🙂': '5461117441612462242',
  '📊': '5231200819986047254',
  '📈': '5244837092042750681',
  '📉': '5246762912428603768',
  '✔️': '5206607081334906820',
  '❓': '5436113877181941026',
  '🗓': '5413879192267805083',
  '🔔': '5458603043203327669',
  '🏠': '5416041192905265756',
  '🎉': '5461151367559141950',
  '✉️': '5253742260054409879',
  '⚡️': '5456140674028019486',
  '🆕': '5382357040008021292',
  '⚠️': '5447644880824181073',
  '🗑': '5445267414562389170',
  '❌': '5210952531676504517',
  '💡': '5422439311196834318',
}

export type MessageEntity = { type: 'custom_emoji'; offset: number; length: number; custom_emoji_id: string }

const EMOJI_LONGEST_FIRST = Object.keys(ANIMATED).sort((left, right) => right.length - left.length)

/**
 * Entities for every NewsEmoji character in a message.
 *
 * `length` is measured in UTF-16 code units because that is what Telegram
 * counts — "📊".length is 2, and "⚠️" is also 2 (symbol plus selector).
 * Reading it off the string itself avoids hand-counting each one wrong.
 */
export function customEmojiEntities(text: string): MessageEntity[] {
  const entities: MessageEntity[] = []

  // String indexes are already UTF-16 offsets, which is exactly what Telegram
  // expects. Moving by code point prevents us from stopping inside a surrogate
  // pair when the current character is not one of ours.
  for (let offset = 0; offset < text.length;) {
    const emoji = EMOJI_LONGEST_FIRST.find((candidate) => text.startsWith(candidate, offset))
    if (emoji) {
      entities.push({ type: 'custom_emoji', offset, length: emoji.length, custom_emoji_id: ANIMATED[emoji]! })
      offset += emoji.length
      continue
    }
    const codePoint = text.codePointAt(offset)
    offset += codePoint !== undefined && codePoint > 0xFFFF ? 2 : 1
  }

  return entities
}

/**
 * Telegram renders button custom emoji through a separate icon field. When a
 * label starts with one of ours, remove the ordinary glyph and return the icon
 * id that must be attached to the button.
 */
export function customEmojiButton(text: string): { text: string; customEmojiId: string | null } {
  const emoji = EMOJI_LONGEST_FIRST.find((candidate) => text.startsWith(candidate))
  if (!emoji) return { text, customEmojiId: null }
  return { text: text.slice(emoji.length).trimStart(), customEmojiId: ANIMATED[emoji]! }
}
