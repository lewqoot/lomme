import { describe, expect, it } from 'vitest'
import { parseQuickLine, type QuickLine } from '../src/shared/quick-entry.js'

const read = (line: string): string => {
  const parsed: QuickLine = parseQuickLine(line)
  return parsed.status === 'ok' ? `${parsed.amount} | ${parsed.text}` : `отказ: ${parsed.reason}`
}

describe('строка «сумма + описание»', () => {
  it('принимает форматы, которыми пользуются', () => {
    expect(read('1250 такси')).toBe('1250 | такси')
    expect(read('кофе 450')).toBe('450 | кофе')
    expect(read('12.5 кофе')).toBe('12.5 | кофе')
    expect(read('12,5 кофе')).toBe('12,5 | кофе')
    expect(read('450')).toBe('450 | ')
  })

  it('собирает сумму, разделённую пробелом по разрядам', () => {
    expect(read('3 200 продукты')).toBe('3 200 | продукты')
    expect(read('продукты 3 200')).toBe('3 200 | продукты')
    expect(read('1 250,50 такси домой')).toBe('1 250,50 | такси домой')
  })

  it('берёт единственное число из середины фразы', () => {
    expect(read('Потратил 300 на кофе')).toBe('300 | Потратил на кофе')
  })

  // Ровно та таблица, на которой аудит показал молчаливую потерю денег.
  it('отказывается там, где раньше записывал неверную сумму', () => {
    // Было: 1,23 ₽ вместо 1234,56 — потеря 1233 рублей без единого признака.
    expect(read('1.234,56 продукты')).toBe('отказ: grouping')
    // Было: 1 ₽.
    expect(read('1к продукты')).toBe('отказ: shorthand')
    // Было: 300 ₽, вторая половина уходила в заметку.
    expect(read('300+200 такси')).toBe('отказ: arithmetic')
    // Было: 12 ₽ из двух не связанных чисел.
    expect(read('такси 1 2')).toBe('отказ: several-amounts')
  })

  it('не принимает доход за трату', () => {
    // Было: расход на 50 000 ₽.
    expect(read('зарплата 50000')).toBe('отказ: income')
    expect(read('+50000 премия')).toBe('отказ: income')
    expect(read('вернули 900 за куртку')).toBe('отказ: income')
  })

  it('не принимает сокращения и валюты за сумму', () => {
    for (const line of ['5 тыс аренда', '300р такси', '20$ подписка', '15 € кофе', '2 млн машина']) {
      expect(read(line)).toBe('отказ: shorthand')
    }
  })

  it('не принимает время за сумму', () => {
    expect(read('встреча в 5 утра')).toBe('отказ: no-amount')
    expect(read('созвон в 10 часов')).toBe('отказ: no-amount')
    // При этом «300 утра» — не фраза о времени: число стоит первым.
    expect(read('300 кофе утром')).toBe('300 | кофе утром')
  })

  it('без чисел и с пустой строкой отвечает про сумму', () => {
    expect(read('кофе с молоком')).toBe('отказ: no-amount')
    expect(read('   ')).toBe('отказ: no-amount')
  })
})
