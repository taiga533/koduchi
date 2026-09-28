import { describe, expect, it } from 'vitest'
import { runTargetOf } from './runTarget'

const 本文 = 'select 1 from dual;\nselect 2 from dual;\nbegin null; end;'

describe('runTargetOf', () => {
  it('カーソル位置の文は選択があっても選択を見ずに head の文を返す', () => {
    // Arrange
    const cursor = { offset: 25, selectedText: 'select 1 from dual;' }

    // Act
    const target = runTargetOf('statement', 本文, cursor)

    // Assert
    expect(target.origin).toBe('document')
    expect(target.statements.map((s) => s.text)).toEqual(['select 2 from dual'])
  })

  it('選択範囲の実行は選択の中を切り出し、位置は選択の先頭から数える', () => {
    // Arrange
    const cursor = { offset: 0, selectedText: '  select 1 from dual; select 2 from dual' }

    // Act
    const target = runTargetOf('selection', 本文, cursor)

    // Assert
    expect(target.origin).toBe('selection')
    expect(target.statements.map((s) => [s.text, s.start])).toEqual([
      ['select 1 from dual', 2],
      ['select 2 from dual', 22],
    ])
  })

  it('選択が無いときの選択範囲の実行は対象が無い', () => {
    // Arrange
    const cursor = { offset: 0, selectedText: null }

    // Act
    const target = runTargetOf('selection', 本文, cursor)

    // Assert
    expect(target.statements).toEqual([])
  })

  it('選択が無いときのスクリプト実行は本文全体の文を返す', () => {
    // Arrange
    const cursor = { offset: 0, selectedText: null }

    // Act
    const target = runTargetOf('script', 本文, cursor)

    // Assert
    expect(target.origin).toBe('document')
    expect(target.statements.map((s) => s.text)).toEqual([
      'select 1 from dual',
      'select 2 from dual',
      'begin null; end;',
    ])
  })

  it('選択があるときのスクリプト実行は選択の中だけを返す', () => {
    // Arrange
    const cursor = { offset: 0, selectedText: 'select 1 from dual;' }

    // Act
    const target = runTargetOf('script', 本文, cursor)

    // Assert
    expect(target.origin).toBe('selection')
    expect(target.statements.map((s) => s.text)).toEqual(['select 1 from dual'])
  })

  it('空の本文ではどの単位でも対象が無い', () => {
    // Arrange
    const cursor = { offset: 0, selectedText: null }

    // Act
    const targets = (['statement', 'selection', 'script'] as const).map((scope) =>
      runTargetOf(scope, '', cursor),
    )

    // Assert
    expect(targets.map((target) => target.statements)).toEqual([[], [], []])
  })

  it.each([
    "select 'abc",
    "select q'[abc from dual",
    'begin if x then',
    'select /* 閉じない',
    'create or replace procedure p is begin',
  ])('書きかけの壊れた SQL（%s）でも例外を出さない', (sql) => {
    // Arrange
    const cursor = { offset: sql.length, selectedText: null }

    // Act
    const target = runTargetOf('statement', sql, cursor)

    // Assert
    expect(target.statements).toHaveLength(1)
    expect(target.statements[0].end).toBeLessThanOrEqual(sql.length)
  })
})
