import { describe, expect, it } from 'vitest'
import {
  formatEdit,
  indentContinuationLines,
  isFormatShortcut,
  selectionIndent,
  unchangedEnds,
} from './formatting'

/** 打鍵の形。`isFormatShortcut` が見る項目だけを持つ。 */
function 打鍵(overrides: Partial<Parameters<typeof isFormatShortcut>[0]> = {}) {
  return {
    code: 'KeyF',
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  }
}

/** 書き換えを本文へ当てた結果を返す。 */
function 当てる(doc: string, from: number, to: number): string {
  const outcome = formatEdit(doc, from, to)
  if (outcome.status !== 'edit') {
    throw new Error(`書き換えが得られなかった: ${JSON.stringify(outcome)}`)
  }
  const { edit } = outcome
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)
}

describe('isFormatShortcut', () => {
  it('⇧⌥F を整形の打鍵と見なす', () => {
    // Arrange
    const event = 打鍵()

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(true)
  })

  it('配列の違いで文字が変わっても、物理キーで拾う', () => {
    // Arrange
    // macOS では `⇧⌥F` が `Ï` になる。`key` を見ていれば拾えない打鍵である。
    const event = { ...打鍵(), key: 'Ï' }

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(true)
  })

  it('⌘ が付いていれば整形の打鍵と見なさない（⌥⌘F は置換）', () => {
    // Arrange
    const event = 打鍵({ metaKey: true })

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(false)
  })

  it('⌃ が付いていれば整形の打鍵と見なさない', () => {
    // Arrange
    const event = 打鍵({ ctrlKey: true })

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(false)
  })

  it('⇧ が無ければ整形の打鍵と見なさない', () => {
    // Arrange
    const event = 打鍵({ shiftKey: false })

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(false)
  })

  it('⌥ が無ければ整形の打鍵と見なさない', () => {
    // Arrange
    const event = 打鍵({ altKey: false })

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(false)
  })

  it('別のキーなら整形の打鍵と見なさない', () => {
    // Arrange
    const event = 打鍵({ code: 'KeyG' })

    // Act
    const 整形か = isFormatShortcut(event)

    // Assert
    expect(整形か).toBe(false)
  })
})

describe('selectionIndent', () => {
  it('行頭から選択の始まりまでが空白だけなら、その空白を下げ幅にする', () => {
    // Arrange
    const doc = 'begin\n    select a from t;\nend;'
    const from = doc.indexOf('select')

    // Act
    const indent = selectionIndent(doc, from)

    // Assert
    expect(indent).toBe('    ')
  })

  it('手前に文字があるときは、その行の行頭の空白を下げ幅にする', () => {
    // Arrange
    const doc = '  select * from (select a from t)'
    const from = doc.indexOf('select a')

    // Act
    const indent = selectionIndent(doc, from)

    // Assert
    expect(indent).toBe('  ')
  })

  it('最初の行でも行頭から数える', () => {
    // Arrange
    const doc = '   select a'
    const from = 3

    // Act
    const indent = selectionIndent(doc, from)

    // Assert
    expect(indent).toBe('   ')
  })

  it('選択が行頭から始まるなら下げ幅を持たせない', () => {
    // Arrange
    const doc = 'select a\n    select b'
    const from = doc.indexOf('\n') + 1

    // Act
    const indent = selectionIndent(doc, from)

    // Assert
    expect(indent).toBe('')
  })
})

describe('indentContinuationLines', () => {
  it('2 行目以降の頭に空白を足す', () => {
    // Arrange
    const text = 'select\n  a\nfrom\n  t'

    // Act
    const indented = indentContinuationLines(text, '  ')

    // Assert
    expect(indented).toBe('select\n    a\n  from\n    t')
  })

  it('1 行目には足さない', () => {
    // Arrange
    const text = 'select\n  a'

    // Act
    const indented = indentContinuationLines(text, '\t')

    // Assert
    expect(indented.startsWith('select')).toBe(true)
  })

  it('空行には足さず、行末に空白を残さない', () => {
    // Arrange
    const text = 'select 1;\n\nselect 2;'

    // Act
    const indented = indentContinuationLines(text, '  ')

    // Assert
    expect(indented.split('\n')).toContain('')
  })

  it('下げ幅が空なら何も変えない', () => {
    // Arrange
    const text = 'select\n  a'

    // Act
    const indented = indentContinuationLines(text, '')

    // Assert
    expect(indented).toBe(text)
  })
})

describe('unchangedEnds', () => {
  it('前後の変わらない部分の長さを返す', () => {
    // Arrange
    const before = 'select a,b from t'
    const after = 'select a, b from t'

    // Act
    const { prefix, suffix } = unchangedEnds(before, after)

    // Assert
    expect(before.slice(0, prefix)).toBe('select a,')
    expect(before.slice(before.length - suffix)).toBe('b from t')
  })

  it('まったく同じなら片側の長さぶんを前として返す', () => {
    // Arrange
    const text = 'select a'

    // Act
    const { prefix } = unchangedEnds(text, text)

    // Assert
    expect(prefix).toBe(text.length)
  })

  it('先頭から違えば削らない', () => {
    // Arrange
    const before = 'abc'
    const after = 'xbc'

    // Act
    const { prefix } = unchangedEnds(before, after)

    // Assert
    expect(prefix).toBe(0)
  })

  it('サロゲートペアの間で切らない', () => {
    // Arrange
    // 「𩸽」と「𠮷」は上位と下位の 2 単位からなり、上位が同じで下位が違う。
    const before = '𩸽'
    const after = '𠮷'

    // Act
    const { prefix, suffix } = unchangedEnds(before, after)

    // Assert
    expect(prefix).toBe(0)
    expect(suffix).toBe(0)
  })
})

describe('formatEdit', () => {
  it('選択が無ければ本文全体を整形する', () => {
    // Arrange
    const doc = 'select a,b from t'

    // Act
    const 当てた後 = 当てる(doc, 5, 5)

    // Assert
    expect(当てた後.split('\n').length).toBeGreaterThan(1)
  })

  it('選択があればその範囲だけを書き換え、外は元のまま残す', () => {
    // Arrange
    const doc = '-- 前置き\nselect a,b from t\n-- 後書き'
    const from = doc.indexOf('select')
    const to = doc.indexOf('\n-- 後書き')

    // Act
    const 当てた後 = 当てる(doc, from, to)

    // Assert
    expect(当てた後.startsWith('-- 前置き\n')).toBe(true)
    expect(当てた後.endsWith('\n-- 後書き')).toBe(true)
  })

  it('選択範囲の 2 行目以降を周りのインデントへ揃える', () => {
    // Arrange
    const doc = '    select a,b from t'
    const from = 4

    // Act
    const 当てた後 = 当てる(doc, from, doc.length)

    // Assert
    const 行 = 当てた後.split('\n')
    expect(行.slice(1).every((line) => line.startsWith('    '))).toBe(true)
  })

  it('変わらない前後を削った差分を返す', () => {
    // Arrange
    const doc = 'select\n  a,\n  b\nfrom\n  t\nwhere\n  c=1'

    // Act
    const outcome = formatEdit(doc, 0, 0)

    // Assert
    // 変わるのは `c=1` の空白だけであり、書き換えの範囲は本文全体より狭い。
    expect(outcome.status === 'edit' && outcome.edit.from).toBeGreaterThan(0)
  })

  it('整形し終えた範囲を region として返す', () => {
    // Arrange
    const doc = 'select a,b from t'

    // Act
    const outcome = formatEdit(doc, 0, doc.length)

    // Assert
    expect(outcome.status === 'edit' && outcome.edit.region.from).toBe(0)
  })

  it('整形しても変わらない本文では書き換えを作らない', () => {
    // Arrange
    const doc = 'select\n  a\nfrom\n  t'

    // Act
    const outcome = formatEdit(doc, 0, 0)

    // Assert
    expect(outcome).toEqual({ status: 'unchanged' })
  })

  it('整形できない本文では失敗を返し、書き換えを作らない', () => {
    // Arrange
    const doc = "select q'[一行目\n二行目]' from dual"

    // Act
    const outcome = formatEdit(doc, 0, 0)

    // Assert
    expect(outcome).toMatchObject({ status: 'failed', reason: 'changed' })
  })

  it('選択範囲だけが整形できないときも本文全体に触れさせない', () => {
    // Arrange
    const doc = "select 'abc from dual"

    // Act
    const outcome = formatEdit(doc, 0, doc.length)

    // Assert
    expect(outcome).toMatchObject({ status: 'failed', reason: 'parseError' })
  })
})
