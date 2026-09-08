import { describe, expect, it } from 'vitest'
import { isUnquotedSafe, styleIdentifier } from './identifiers'

describe('isUnquotedSafe', () => {
  it('全角文字を含まない全大文字の名前は引用符なしで書ける', () => {
    // Arrange
    const name = 'ORDER_ITEMS'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(true)
  })

  it('小文字を含む名前は引用符が要る', () => {
    // Arrange: 引用符付きで作られた表を模す
    const name = 'MyTable'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(false)
  })

  it('空白を含む名前は引用符が要る', () => {
    // Arrange
    const name = 'ORDER ITEMS'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(false)
  })

  it('数字で始まる名前は引用符が要る', () => {
    // Arrange
    const name = '1ST_QUARTER'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(false)
  })

  it('予約語は全大文字でも引用符が要る', () => {
    // Arrange: `"SELECT"` として作られた表を模す
    const name = 'SELECT'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(false)
  })

  it('ドル記号と番号記号は識別子に使える', () => {
    // Arrange
    const name = 'V$SESSION'

    // Act
    const 安全 = isUnquotedSafe(name)

    // Assert
    expect(安全).toBe(true)
  })
})

describe('styleIdentifier', () => {
  it('小文字を選ぶと小文字で挿入される', () => {
    // Arrange
    const name = 'ORDER_ITEMS'

    // Act
    const styled = styleIdentifier(name, 'lower')

    // Assert
    expect(styled).toEqual({ label: 'order_items' })
  })

  it('カタログのままを選ぶと大文字のまま挿入される', () => {
    // Arrange
    const name = 'ORDER_ITEMS'

    // Act
    const styled = styleIdentifier(name, 'preserve')

    // Assert
    expect(styled).toEqual({ label: 'ORDER_ITEMS' })
  })

  it('大文字を選ぶと大文字で挿入される', () => {
    // Arrange
    const name = 'ORDER_ITEMS'

    // Act
    const styled = styleIdentifier(name, 'upper')

    // Assert
    expect(styled).toEqual({ label: 'ORDER_ITEMS' })
  })

  it('引用符が要る名前は小文字を選んでも綴りを変えずに囲む', () => {
    // Arrange: 小文字化すると別の名前に解決されてしまう
    const name = 'MyTable'

    // Act
    const styled = styleIdentifier(name, 'lower')

    // Assert
    expect(styled).toEqual({ label: 'MyTable', apply: '"MyTable"' })
  })

  it('予約語の名前は引用符付きで挿入される', () => {
    // Arrange
    const name = 'TABLE'

    // Act
    const styled = styleIdentifier(name, 'lower')

    // Assert
    expect(styled).toEqual({ label: 'TABLE', apply: '"TABLE"' })
  })
})
