import { describe, expect, it } from 'vitest'
import { leadingEmojiEntities } from '../server/telegram/custom-emoji.js'
import { dailyReminder, monthlyDigest, sharedWalletDigest, weeklyDigest } from '../server/telegram/texts.js'

describe('анимированные эмодзи в заголовке', () => {
  it('размечает ведущий эмодзи, если для него есть анимированный', () => {
    expect(leadingEmojiEntities('📊 Неделя закрыта')).toEqual([
      { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5231200819986047254' },
    ])
  })

  it('считает длину в кодовых единицах UTF-16, как этого ждёт Telegram', () => {
    // Длина берётся из самой строки, а не проставляется руками: 📊 — это
    // суррогатная пара, а ⚠️ — символ плюс селектор начертания, и обе записи
    // дают по две единицы, хотя выглядят как один знак.
    expect(leadingEmojiEntities('📊 Неделя закрыта')[0]?.length).toBe('📊'.length)
    expect(leadingEmojiEntities('⚠️ Бюджет на исходе')[0]?.length).toBe('⚠️'.length)
  })

  it('не трогает текст без эмодзи и эмодзи не в начале', () => {
    expect(leadingEmojiEntities('Неделя закрыта')).toEqual([])
    expect(leadingEmojiEntities('Итоги 📊 недели')).toEqual([])
  })

  it('игнорирует эмодзи, которого нет в наборе', () => {
    expect(leadingEmojiEntities('🥑 Авокадо')).toEqual([])
  })

  it('заголовки рассылок действительно попадают под разметку', () => {
    const texts = [
      weeklyDigest({ expenseKopecks: 100, previousExpenseKopecks: null, top: [] }).text,
      monthlyDigest({ year: 2026, month: 8, incomeKopecks: 1, expenseKopecks: 1, netKopecks: 0, top: [] }).text,
      sharedWalletDigest('Семья', [{ name: 'Аня', count: 1, amountKopecks: 100 }]).text,
      dailyReminder(0).text,
    ]

    for (const text of texts) expect(leadingEmojiEntities(text)).toHaveLength(1)
  })
})
