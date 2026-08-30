import { describe, expect, it } from 'vitest'
import { fromKopecks, initialCalc, pressKey, resolveKopecks, toKopecks, type CalcKey } from '../src/features/editor/calculator.js'

const type = (keys: string) => [...keys].reduce((state, key) => pressKey(state, key as CalcKey), initialCalc())
const typed = (keys: string) => type(keys).entry

describe('калькулятор редактора', () => {
  it('набирает число и заменяет ведущий ноль', () => {
    expect(typed('50')).toBe('50')
    expect(typed('0')).toBe('0')
  })

  it('держит не более двух знаков после запятой', () => {
    expect(typed('12,345')).toBe('12,34')
  })

  it('не даёт поставить вторую запятую', () => {
    expect(typed('1,2,3')).toBe('1,23')
  })

  it('складывает без потери копеек', () => {
    const state = type('10,10+20,20')
    expect(resolveKopecks(state)).toBe(3_030)
  })

  it('вычитает и показывает промежуточный итог при следующем операторе', () => {
    const state = type('100−30+')
    expect(state.entry).toBe('70')
    expect(resolveKopecks(state)).toBe(7_000)
  })

  it('умножает и делит', () => {
    expect(resolveKopecks(type('12,50×4'))).toBe(5_000)
    expect(resolveKopecks(type('100÷3'))).toBe(3_333)
  })

  it('деление на ноль оставляет прежнее значение', () => {
    expect(resolveKopecks(type('100÷0'))).toBe(10_000)
  })

  it('повторный оператор только меняет знак операции', () => {
    const state = type('10+−5')
    expect(resolveKopecks(state)).toBe(500)
  })

  it('backspace убирает по одному символу', () => {
    expect(typed('123⌫')).toBe('12')
    expect(typed('1⌫')).toBe('0')
  })

  it('конвертация копеек в обе стороны', () => {
    expect(toKopecks('50')).toBe(5_000)
    expect(toKopecks('0,05')).toBe(5)
    expect(fromKopecks(5_000)).toBe('50')
    expect(fromKopecks(5)).toBe('0,05')
  })
})
