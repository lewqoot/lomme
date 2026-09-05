import { describe, expect, it } from 'vitest'
import { customEmojiButton, customEmojiEntities } from '../server/telegram/custom-emoji.js'
import { dailyReminder, monthlyDigest, recorded, sharedWalletDigest, weeklyDigest } from '../server/telegram/texts.js'

describe('анимированные эмодзи в сообщении', () => {
  it('размечает эмодзи из NewsEmoji в любой позиции', () => {
    expect(customEmojiEntities('📊 Итоги и 🔔 напоминание')).toEqual([
      { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5231200819986047254' },
      { type: 'custom_emoji', offset: 11, length: 2, custom_emoji_id: '5458603043203327669' },
    ])
  })

  it('считает длину в кодовых единицах UTF-16, как этого ждёт Telegram', () => {
    // Длина берётся из самой строки, а не проставляется руками: 📊 — это
    // суррогатная пара, а ⚠️ — символ плюс селектор начертания, и обе записи
    // дают по две единицы, хотя выглядят как один знак.
    expect(customEmojiEntities('📊 Неделя закрыта')[0]?.length).toBe('📊'.length)
    expect(customEmojiEntities('⚠️ Бюджет на исходе')[0]?.length).toBe('⚠️'.length)
  })

  it('не трогает текст без эмодзи', () => {
    expect(customEmojiEntities('Неделя закрыта')).toEqual([])
  })

  it('игнорирует эмодзи, которого нет в наборе', () => {
    expect(customEmojiEntities('🥑 Авокадо')).toEqual([])
  })

  it('выносит кастомный эмодзи из текста кнопки в icon_custom_emoji_id', () => {
    expect(customEmojiButton('⚡️ Настроить шорткат')).toEqual({
      text: 'Настроить шорткат',
      customEmojiId: '5456140674028019486',
    })
  })

  it('заголовки рассылок действительно попадают под разметку', () => {
    const texts = [
      weeklyDigest({ expenseKopecks: 100, previousExpenseKopecks: null, top: [] }).text,
      monthlyDigest({ year: 2026, month: 8, incomeKopecks: 1, expenseKopecks: 1, netKopecks: 0, top: [] }).text,
      sharedWalletDigest('Семья', [{ name: 'Аня', count: 1, amountKopecks: 100 }]).text,
      dailyReminder(0).text,
      recorded(100, 'Кофе', 'tx').text,
    ]

    for (const text of texts) expect(customEmojiEntities(text)).toHaveLength(1)
  })
})
