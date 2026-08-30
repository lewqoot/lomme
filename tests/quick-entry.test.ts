import { describe, expect, it } from 'vitest'
import { parseQuickAmount, resolveQuickEntry, splitQuickInput } from '../src/shared/quick-entry.js'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'

const category = (id: string, name: string): CategoryView =>
  ({ id, name, type: 'expense', icon: 'circle-slash-2', color: '#000', order: 0, parentId: null, version: 1, archivedAt: null })

const categories = [
  category('metro', 'Метро и автобус'),
  category('food', 'Продукты'),
  category('cafe', 'Кафе и рестораны'),
  category('home', 'Дом и быт'),
]
const past = (note: string, categoryId: string | null): Pick<TransactionView, 'note' | 'categoryId' | 'type'> =>
  ({ note, categoryId, type: 'expense' })

const resolve = (text: string, history: ReturnType<typeof past>[] = []) =>
  resolveQuickEntry(text, 8_000, categories, history)

describe('разбор строки из шортката', () => {
  it('находит категорию по полному названию', () => {
    expect(resolve('метро и автобус').categoryId).toBe('metro')
  })

  it('находит по первому слову, остальное уходит в заметку', () => {
    const result = resolve('Продукты на неделю')
    expect(result.categoryId).toBe('food')
    expect(result.note).toBe('на неделю')
  })

  it('прощает опечатку в длинном названии', () => {
    expect(resolve('прдукты').categoryId).toBe('food')
  })

  it('не путает короткие разные слова', () => {
    // «дом» и «дым» отличаются одной буквой, но это разные вещи.
    expect(resolve('дым').categoryId).toBeNull()
  })

  it('вспоминает категорию по прошлой заметке', () => {
    const result = resolve('стики', [past('стики', 'home')])
    expect(result.categoryId).toBe('home')
    expect(result.note).toBe('стики')
  })

  it('игнорирует историю, если категория уже удалена', () => {
    expect(resolve('стики', [past('стики', 'gone')]).categoryId).toBeNull()
  })

  it('незнакомый текст оставляет без категории и не выдумывает новую', () => {
    const result = resolve('обед с Сашей')
    expect(result.categoryId).toBeNull()
    expect(result.categoryGuessed).toBe(false)
    expect(result.note).toBe('обед с Сашей')
  })

  it('сумму без описания всегда оставляет без категории', () => {
    const result = resolve('', [past('', 'food')])
    expect(result.categoryId).toBeNull()
    expect(result.categoryGuessed).toBe(false)
    expect(result.note).toBe('')
  })

  it('любая найденная категория помечена как угаданная', () => {
    expect(resolve('метро и автобус').categoryGuessed).toBe(true)
  })

  it('регистр и ё не мешают', () => {
    expect(resolve('МЕТРО И АВТОБУС').categoryId).toBe('metro')
  })
})

describe('разбор суммы', () => {
  it('принимает привычные записи', () => {
    expect(parseQuickAmount('80')).toBe(8_000)
    expect(parseQuickAmount('1 250,50')).toBe(125_050)
    expect(parseQuickAmount('12.5')).toBe(1_250)
    expect(parseQuickAmount(80)).toBe(8_000)
  })

  it('отклоняет мусор, ноль и отрицательные', () => {
    for (const value of ['', 'много', '-80', '0', '1,234']) expect(parseQuickAmount(value)).toBeNull()
  })
})

describe('одна строка «сумма + текст»', () => {
  it('делит ввод независимо от порядка и формата суммы', () => {
    expect(splitQuickInput('1250 такси')).toEqual({ amount: '1250', text: 'такси' })
    expect(splitQuickInput('1 250,50 такси домой')).toEqual({ amount: '1 250,50', text: 'такси домой' })
    expect(splitQuickInput('такси 300')).toEqual({ amount: '300', text: 'такси' })
    expect(splitQuickInput('80')).toEqual({ amount: '80', text: '' })
    expect(splitQuickInput('  12.5  кофе ')).toEqual({ amount: '12.5', text: 'кофе' })
  })

  it('возвращает null, когда суммы нет', () => {
    expect(splitQuickInput('такси')).toBeNull()
    expect(splitQuickInput('')).toBeNull()
  })
})
