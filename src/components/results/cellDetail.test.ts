import { describe, expect, it } from 'vitest'
import { characterCount, detailBody, formatJson, isOpaque, looksLikeJson } from './cellDetail'

describe('looksLikeJson', () => {
  it('中かっこで始まる値は JSON らしいと見なす', () => {
    // Arrange
    const text = '{"a":1}'

    // Act
    const result = looksLikeJson(text)

    // Assert
    expect(result).toBe(true)
  })

  it('角かっこで始まる値も JSON らしいと見なす', () => {
    // Arrange
    const text = '  [1, 2]'

    // Act
    const result = looksLikeJson(text)

    // Assert
    expect(result).toBe(true)
  })

  it('数値だけの値は JSON らしいと見なさない', () => {
    // Arrange
    const text = '12345'

    // Act
    const result = looksLikeJson(text)

    // Assert
    expect(result).toBe(false)
  })

  it('空文字列は JSON らしいと見なさない', () => {
    // Arrange
    const text = ''

    // Act
    const result = looksLikeJson(text)

    // Assert
    expect(result).toBe(false)
  })
})

describe('formatJson', () => {
  it('JSON として読める値は字下げして整形される', () => {
    // Arrange
    const text = '{"id":1,"name":"太郎"}'

    // Act
    const formatted = formatJson(text)

    // Assert
    expect(formatted).toBe('{\n  "id": 1,\n  "name": "太郎"\n}')
  })

  it('かっこで始まっても壊れていれば整形しない', () => {
    // Arrange
    const text = '{"id":1,'

    // Act
    const formatted = formatJson(text)

    // Assert
    expect(formatted).toBeNull()
  })

  it('JSON らしくない値は整形しない', () => {
    // Arrange
    const text = 'ORD-0001'

    // Act
    const formatted = formatJson(text)

    // Assert
    expect(formatted).toBeNull()
  })
})

describe('characterCount', () => {
  it('文字数を数える', () => {
    // Arrange
    const text = '受注番号'

    // Act
    const count = characterCount(text)

    // Assert
    expect(count).toBe(4)
  })

  it('サロゲートペアは 1 文字として数える', () => {
    // Arrange
    const text = '𠮷野家'

    // Act
    const count = characterCount(text)

    // Assert
    expect(count).toBe(3)
  })
})

describe('detailBody', () => {
  it('整形が有効なら JSON は整形して出す', () => {
    // Arrange
    const cell = { text: '[1,2]', kind: 'text' as const }

    // Act
    const body = detailBody(cell, true)

    // Assert
    expect(body).toBe('[\n  1,\n  2\n]')
  })

  it('整形を切ると生のまま出す', () => {
    // Arrange
    const cell = { text: '[1,2]', kind: 'text' as const }

    // Act
    const body = detailBody(cell, false)

    // Assert
    expect(body).toBe('[1,2]')
  })

  it('整形できない値は生のまま出す', () => {
    // Arrange
    const cell = { text: '{壊れている', kind: 'text' as const }

    // Act
    const body = detailBody(cell, true)

    // Assert
    expect(body).toBe('{壊れている')
  })

  it('NULL は NULL という文字列として出す', () => {
    // Arrange
    const cell = { text: '', kind: 'null' as const }

    // Act
    const body = detailBody(cell, true)

    // Assert
    expect(body).toBe('NULL')
  })
})

describe('isOpaque', () => {
  it('BLOB は中身を出せない値と判定される', () => {
    // Arrange
    const cell = { text: '[BLOB 1.2 KB]', kind: 'binary' as const }

    // Act
    const opaque = isOpaque(cell)

    // Assert
    expect(opaque).toBe(true)
  })

  it('文字列は中身を出せる値と判定される', () => {
    // Arrange
    const cell = { text: 'abc', kind: 'text' as const }

    // Act
    const opaque = isOpaque(cell)

    // Assert
    expect(opaque).toBe(false)
  })
})
