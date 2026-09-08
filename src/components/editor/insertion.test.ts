import { describe, expect, it } from 'vitest'
import { qualifiedIdentifier, selectAllStatement, withLeadingSpace } from './insertion'

describe('qualifiedIdentifier', () => {
  it('綴りを小文字にするとスキーマ修飾ごと小文字になる', () => {
    // Arrange
    const names = ['KODUCHI', 'ORDER_ITEMS']

    // Act
    const text = qualifiedIdentifier(names, 'lower')

    // Assert
    expect(text).toBe('koduchi.order_items')
  })

  it('綴りを大文字にすると大文字になる', () => {
    // Arrange
    const names = ['KODUCHI', 'ORDER_ITEMS']

    // Act
    const text = qualifiedIdentifier(names, 'upper')

    // Assert
    expect(text).toBe('KODUCHI.ORDER_ITEMS')
  })

  it('カタログのままを選ぶとカタログの綴りで出る', () => {
    // Arrange
    const names = ['KODUCHI', 'ORDER_ITEMS']

    // Act
    const text = qualifiedIdentifier(names, 'preserve')

    // Assert
    expect(text).toBe('KODUCHI.ORDER_ITEMS')
  })

  it('引用符が要る名前は綴りを変えずに囲む', () => {
    // Arrange: 小文字を含む名前は無引用で書くと別の名前へ解決される（ADR 0013）
    const names = ['KODUCHI', 'MyTable']

    // Act
    const text = qualifiedIdentifier(names, 'lower')

    // Assert
    expect(text).toBe('koduchi."MyTable"')
  })

  it('予約語の名前は綴りを変えずに囲む', () => {
    // Arrange
    const names = ['KODUCHI', 'SELECT']

    // Act
    const text = qualifiedIdentifier(names, 'lower')

    // Assert
    expect(text).toBe('koduchi."SELECT"')
  })

  it('名前が 1 つなら修飾せずにその綴りだけを返す', () => {
    // Arrange: 列は修飾しない（ADR 0020）
    const names = ['USER_ID']

    // Act
    const text = qualifiedIdentifier(names, 'lower')

    // Assert
    expect(text).toBe('user_id')
  })
})

describe('withLeadingSpace', () => {
  it('文書の先頭では空白を足さない', () => {
    // Arrange
    const preceding = ''

    // Act
    const text = withLeadingSpace('koduchi.users', preceding)

    // Assert
    expect(text).toBe('koduchi.users')
  })

  it('直前が空白ならもう 1 つは足さない', () => {
    // Arrange
    const preceding = ' '

    // Act
    const text = withLeadingSpace('koduchi.users', preceding)

    // Assert
    expect(text).toBe('koduchi.users')
  })

  it('直前が改行でも足さない', () => {
    // Arrange
    const preceding = '\n'

    // Act
    const text = withLeadingSpace('koduchi.users', preceding)

    // Assert
    expect(text).toBe('koduchi.users')
  })

  it('直前が語の途中なら空白を足して繋がらないようにする', () => {
    // Arrange: `from` の直後へ入れて `fromkoduchi` になるのを防ぐ
    const preceding = 'm'

    // Act
    const text = withLeadingSpace('koduchi.users', preceding)

    // Assert
    expect(text).toBe(' koduchi.users')
  })

  it('直前が開き括弧なら足さない', () => {
    // Arrange
    const preceding = '('

    // Act
    const text = withLeadingSpace('user_id', preceding)

    // Assert
    expect(text).toBe('user_id')
  })

  it('直前がピリオドなら足さない', () => {
    // Arrange: 修飾の途中である
    const preceding = '.'

    // Act
    const text = withLeadingSpace('user_id', preceding)

    // Assert
    expect(text).toBe('user_id')
  })

  it('直前が読点なら空白を足す', () => {
    // Arrange
    const preceding = ','

    // Act
    const text = withLeadingSpace('user_id', preceding)

    // Assert
    expect(text).toBe(' user_id')
  })
})

describe('selectAllStatement', () => {
  it('キーワードは小文字で識別子は指定の綴りになる', () => {
    // Arrange
    const names = ['KODUCHI', 'USERS']

    // Act
    const sql = selectAllStatement(names, 'lower')

    // Assert
    expect(sql).toBe('select * from koduchi.users')
  })

  it('綴りを大文字にしてもキーワードは小文字のままである', () => {
    // Arrange
    const names = ['KODUCHI', 'USERS']

    // Act
    const sql = selectAllStatement(names, 'upper')

    // Assert
    expect(sql).toBe('select * from KODUCHI.USERS')
  })

  it('引用符が要る名前は囲まれたまま文に入る', () => {
    // Arrange
    const names = ['KODUCHI', 'MyTable']

    // Act
    const sql = selectAllStatement(names, 'lower')

    // Assert
    expect(sql).toBe('select * from koduchi."MyTable"')
  })
})
