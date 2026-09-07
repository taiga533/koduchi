import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ResultTable } from './ResultTable'
import { emptyExecution, type TabExecution } from '../../stores/execution'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { createFakeClipboard, type FakeClipboard } from '../../test/fakeClipboardApi'

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

/** 選択中のセルの testid を並べる。 */
function 選択中のセル(): string[] {
  return [...document.querySelectorAll('[data-selected="true"]')].map(
    (element) => element.getAttribute('data-testid') ?? '',
  )
}

describe('ResultTable のセル選択とコピー', () => {
  /** 3 行 2 列。NULL を 1 つ含む。 */
  const 選択用の結果: TabExecution = {
    ...emptyExecution,
    status: 'succeeded',
    columns: [
      { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
      { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
    ],
    rows: [
      [
        { text: '10', kind: 'number' },
        { text: 'あ', kind: 'text' },
      ],
      [
        { text: '20', kind: 'number' },
        { text: 'い', kind: 'text' },
      ],
      [
        { text: '30', kind: 'number' },
        { text: '', kind: 'null' },
      ],
    ],
    exhausted: true,
    elapsedMs: 12,
  }

  let クリップボード: FakeClipboard

  beforeEach(() => {
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
  })

  it('セルを押すとそのセルだけが選択される', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-1'])
  })

  it('⇧ を伴うクリックで矩形に広がる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'), { shiftKey: true })

    // Assert
    expect(選択中のセル()).toEqual([
      'result-cell-0-0',
      'result-cell-0-1',
      'result-cell-1-0',
      'result-cell-1-1',
    ])
  })

  it('ドラッグで矩形選択できる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseEnter(screen.getByTestId('result-cell-1-0'))
    fireEvent.mouseUp(window)

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-0', 'result-cell-1-0'])
  })

  it('離した後にセルへ入っても選択は広がらない', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseUp(window)

    // Act
    fireEvent.mouseEnter(screen.getByTestId('result-cell-2-1'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-0'])
  })

  it('行番号を押すと行全体が選択される', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-row-number-2'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-2-0', 'result-cell-2-1'])
  })

  it('⌘A で表示中の全行が選択される', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'a', metaKey: true })

    // Assert
    expect(選択中のセル()).toHaveLength(6)
  })

  it('矢印キーで選択が 1 セル動く', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'ArrowDown' })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
  })

  it('⇧ + 矢印で選択が伸びる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), {
      key: 'ArrowRight',
      shiftKey: true,
    })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-0', 'result-cell-0-1'])
  })

  it('End で行末へ Home で行頭へ移る', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-0'))
    const 本文 = screen.getByTestId('result-table-body')

    // Act
    fireEvent.keyDown(本文, { key: 'End' })
    const 行末 = 選択中のセル()
    fireEvent.keyDown(本文, { key: 'Home' })

    // Assert
    expect(行末).toEqual(['result-cell-1-1'])
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
  })

  it('⌘C で選択範囲がタブ区切りでクリップボードへ載る', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'), { shiftKey: true })

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.last()).toBe('10\tあ\n20\tい')
  })

  it('⇧⌘C では列見出しが 1 行目に付く', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-1'), { shiftKey: true })

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), {
      key: 'c',
      metaKey: true,
      shiftKey: true,
    })

    // Assert
    expect(クリップボード.last()).toBe('ID\tLABEL\n10\tあ')
  })

  it('NULL のセルは NULL としてコピーされる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-2-1'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.last()).toBe('NULL')
  })

  it('選択が無ければ ⌘C は何も書かない', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.written).toEqual([])
  })

  it('右クリックでメニューが出てそのセルが選択される', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.contextMenu(screen.getByTestId('result-cell-1-0'))

    // Assert
    expect(screen.getByTestId('result-context-menu')).toBeInTheDocument()
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
  })

  it('メニューの「見出し付きでコピー」は列名を添える', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.contextMenu(screen.getByTestId('result-cell-0-1'))

    // Act
    fireEvent.click(screen.getByText('見出し付きでコピー'))

    // Assert
    expect(クリップボード.last()).toBe('LABEL\nあ')
  })

  it('メニューの「この列をコピー」は表示中の全行を載せる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.contextMenu(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.click(screen.getByText('この列をコピー'))

    // Assert
    expect(クリップボード.last()).toBe('10\n20\n30')
  })

  it('メニューの外を押すと閉じる', () => {
    // Arrange
    render(<ResultTable execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.contextMenu(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-context-menu-backdrop'))

    // Assert
    expect(screen.queryByTestId('result-context-menu')).not.toBeInTheDocument()
  })
})
