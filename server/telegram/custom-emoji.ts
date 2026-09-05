/**
 * Animated emoji for the first character of a message.
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
 * Only the leading emoji of a message is decorated. A heading earns the
 * animation; an emoji inside a sentence would just be noise, and the entity
 * offsets would have to be computed against the whole string.
 *
 * The ✅ that confirms a recorded expense is deliberately absent: those arrive
 * many times a day and match the shortcut's own reply, which cannot animate
 * anything. Matching the two matters more than decorating one of them.
 */

/** Plain emoji → id of its animated twin in the set. */
const ANIMATED: Readonly<Record<string, string>> = {
  '📊': '5231200819986047254',
  '📈': '5244837092042750681',
  '📉': '5246762912428603768',
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

/**
 * The entity for a message's leading emoji, if it has an animated twin.
 *
 * `length` is measured in UTF-16 code units because that is what Telegram
 * counts — "📊".length is 2, and an emoji carrying a variation selector is 3.
 * Reading it off the string itself avoids hand-counting each one wrong.
 */
export function leadingEmojiEntities(text: string): MessageEntity[] {
  // Longest key first, so "⚠️" (with its variation selector) is preferred over
  // a bare "⚠" that happens to be a prefix of it.
  for (const emoji of Object.keys(ANIMATED).sort((left, right) => right.length - left.length)) {
    if (text.startsWith(emoji)) {
      return [{ type: 'custom_emoji', offset: 0, length: emoji.length, custom_emoji_id: ANIMATED[emoji]! }]
    }
  }
  return []
}
