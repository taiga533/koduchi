import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ResultTable } from './ResultTable'
import { emptyExecution, type TabExecution } from '../../stores/execution'

/**
 * jsdom は要素の寸法を持たない。仮想スクロールは `offsetHeight` で表示領域を
 * 測るため、そのままだと領域が 0 と見なされて行が 1 つも描かれない。
 *
 * 補うのは寸法だけで、アプリの振る舞いは差し替えていない。
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  })
})

/** NULL と空文字列を 1 行ずつ含む結果。 */
const 結果: TabExecution = {
  ...emptyExecution,
  status: 'succeeded',
  columns: [
    { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
    { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
  ],
  // 行番号（1 と 2）と紛れないよう、ID の値は 2 桁にしてある。
  rows: [
    [
      { text: '10', kind: 'number' },
      { text: '', kind: 'text' },
    ],
    [
      { text: '20', kind: 'number' },
      { text: '', kind: 'null' },
    ],
  ],
  exhausted: true,
  elapsedMs: 12,
}

describe('ResultTable', () => {
  it('列見出しに列名が並ぶ', () => {
    // Arrange
    // 結果は 2 列

    // Act
    render(<ResultTable execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('LABEL')).toBeInTheDocument()
  })

  it('NULL は NULL と表示され空文字列と区別できる', () => {
    // Arrange
    // 1 行目は空文字列、2 行目は NULL

    // Act
    render(<ResultTable execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('NULL')).toBeInTheDocument()
  })

  it('行番号が 1 から振られる', () => {
    // Arrange
    // 結果は 2 行

    // Act
    render(<ResultTable execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('カーソルが尽きていなければ続きを要求する', () => {
    // Arrange: 取得済みは 2 行だけで、まだ続きがある
    const 途中の結果: TabExecution = { ...結果, exhausted: false }
    const 要求 = vi.fn()

    // Act
    render(<ResultTable execution={途中の結果} onRequestMore={要求} />)

    // Assert
    expect(要求).toHaveBeenCalled()
  })

  it('カーソルが尽きていれば続きを要求しない', () => {
    // Arrange
    const 要求 = vi.fn()

    // Act
    render(<ResultTable execution={結果} onRequestMore={要求} />)

    // Assert
    expect(要求).not.toHaveBeenCalled()
  })

  it('取得中はさらに要求しない', () => {
    // Arrange
    const 取得中: TabExecution = { ...結果, exhausted: false, loadingMore: true }
    const 要求 = vi.fn()

    // Act
    render(<ResultTable execution={取得中} onRequestMore={要求} />)

    // Assert
    expect(要求).not.toHaveBeenCalled()
  })

  it('見出しと本文は同じ最小幅を持つ', () => {
    // Arrange
    // 数値 110 + 文字列 160 + 行番号 44 = 314

    // Act
    render(<ResultTable execution={結果} onRequestMore={() => {}} />)

    // Assert
    const header = screen.getByTestId('result-table-header').firstElementChild as HTMLElement
    const body = screen.getByTestId('result-table-body').firstElementChild as HTMLElement
    expect(header.style.minWidth).toBe('314px')
    expect(body.style.minWidth).toBe('314px')
  })

  it('本文を横スクロールすると見出しも同じだけ動く', () => {
    // Arrange
    render(<ResultTable execution={結果} onRequestMore={() => {}} />)
    const header = screen.getByTestId('result-table-header')
    const body = screen.getByTestId('result-table-body')

    // Act
    body.scrollLeft = 120
    fireEvent.scroll(body)

    // Assert
    expect(header.scrollLeft).toBe(120)
  })

  it('0 行のときは列見出しを残したまま空状態を出す', () => {
    // Arrange
    const 空の結果: TabExecution = { ...結果, rows: [] }

    // Act
    render(<ResultTable execution={空の結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('一致する行がありません')).toBeInTheDocument()
  })
})
