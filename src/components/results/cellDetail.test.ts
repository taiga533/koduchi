import { describe, expect, it } from 'vitest'
import {
  characterCount,
  detailBody,
  formatJson,
  isOpaque,
  isTruncated,
  looksLikeJson,
  sizeLabel,
} from './cellDetail'

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

describe('isTruncated', () => {
  it('切り詰められたセルは真と判定される', () => {
    // Arrange
    const cell = { text: 'あい', kind: 'text' as const, truncated: true }

    // Act
    const truncated = isTruncated(cell)

    // Assert
    expect(truncated).toBe(true)
  })

  it('印を持たないセルは切り詰められていないと判定される', () => {
    // Arrange: Rust 側は切れていないセルで項目そのものを省く
    const cell = { text: 'あい', kind: 'text' as const }

    // Act
    const truncated = isTruncated(cell)

    // Assert
    expect(truncated).toBe(false)
  })
})

describe('sizeLabel', () => {
  it('切り詰められていない値は文字数だけを出す', () => {
    // Arrange
    const cell = { text: 'abcde', kind: 'text' as const }

    // Act
    const label = sizeLabel(cell)

    // Assert
    expect(label).toBe('5 文字')
  })

  it('切り詰められた値には先頭までである旨を添える', () => {
    // Arrange
    const cell = { text: 'abcde', kind: 'text' as const, truncated: true }

    // Act
    const label = sizeLabel(cell)

    // Assert
    expect(label).toContain('5 文字')
    expect(label).toContain('先頭 64 KB のみ')
    expect(label).toContain('切り詰められています')
  })

  it('切り詰めの有無で文字数の表示が必ず変わる', () => {
    // Arrange: 同じ本文でも、切れているなら「これで全部だ」と読ませてはならない
    const 本文 = '{"id":1}'

    // Act
    const 切れていない = sizeLabel({ text: 本文, kind: 'text' })
    const 切れている = sizeLabel({ text: 本文, kind: 'text', truncated: true })

    // Assert
    expect(切れている).not.toBe(切れていない)
    expect(切れている.startsWith(切れていない)).toBe(true)
  })

  it('NULL は値なしと出す', () => {
    // Arrange
    const cell = { text: '', kind: 'null' as const }

    // Act
    const label = sizeLabel(cell)

    // Assert
    expect(label).toBe('値なし（NULL）')
  })
})

describe('detailBody', () => {
  it('切り詰められた値でも本文には印を混ぜない', () => {
    // Arrange: パネルの本文は選んでコピーできるデータであり、注記を混ぜると汚れる
    const cell = { text: '{"id":1', kind: 'text' as const, truncated: true }

    // Act
    const body = detailBody(cell, true)

    // Assert
    expect(body).toBe('{"id":1')
  })
})
