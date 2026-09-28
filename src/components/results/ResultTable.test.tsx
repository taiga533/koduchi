import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ResultTable } from './ResultTable'
import { emptyExecution, type TabExecution } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { createFakeClipboard, type FakeClipboard } from '../../test/fakeClipboardApi'
import { defaultResultDisplay } from './resultDisplay'

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

// 列幅は zustand のストアに残るため、テストごとに白紙へ戻す。
beforeEach(() => {
  useUiStore.setState({
    resultColumnWidths: {},
    resultDisplayDefaults: defaultResultDisplay,
    resultDisplayOverrides: {},
    resultFrozenColumns: {},
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
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('LABEL')).toBeInTheDocument()
  })

  it('NULL は NULL と表示され空文字列と区別できる', () => {
    // Arrange
    // 1 行目は空文字列、2 行目は NULL

    // Act
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('NULL')).toBeInTheDocument()
  })

  it('行番号が 1 から振られる', () => {
    // Arrange
    // 結果は 2 行

    // Act
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('カーソルが尽きていなければ続きを要求する', () => {
    // Arrange: 取得済みは 2 行だけで、まだ続きがある
    const 途中の結果: TabExecution = { ...結果, exhausted: false }
    const 要求 = vi.fn()

    // Act
    render(<ResultTable tabId="tab-1" execution={途中の結果} onRequestMore={要求} />)

    // Assert
    expect(要求).toHaveBeenCalled()
  })

  it('カーソルが尽きていれば続きを要求しない', () => {
    // Arrange
    const 要求 = vi.fn()

    // Act
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={要求} />)

    // Assert
    expect(要求).not.toHaveBeenCalled()
  })

  it('取得中はさらに要求しない', () => {
    // Arrange
    const 取得中: TabExecution = { ...結果, exhausted: false, loadingMore: true }
    const 要求 = vi.fn()

    // Act
    render(<ResultTable tabId="tab-1" execution={取得中} onRequestMore={要求} />)

    // Assert
    expect(要求).not.toHaveBeenCalled()
  })

  it('見出しと本文は同じ最小幅を持つ', () => {
    // Arrange
    // 数値 110 + 文字列 160 + 行番号 44 = 314

    // Act
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Assert
    const header = screen.getByTestId('result-table-header').firstElementChild as HTMLElement
    const body = screen.getByTestId('result-table-body').firstElementChild as HTMLElement
    expect(header.style.minWidth).toBe('314px')
    expect(body.style.minWidth).toBe('314px')
  })

  it('本文を横スクロールすると見出しも同じだけ動く', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
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
    render(<ResultTable tabId="tab-1" execution={空の結果} onRequestMore={() => {}} />)

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

/**
 * 右クリックを実際のブラウザと同じ順で起こす。
 *
 * ブラウザは `contextmenu` の前に `mousedown`（`button` が 2）を、後に `mouseup` を
 * 起こす。`contextmenu` だけを起こすと、押し下げが選択を潰す取りこぼし（issue #53）を
 * テストが見逃す。
 */
function 右クリック(element: HTMLElement, options: { ctrlKey?: boolean } = {}) {
  const init = { button: options.ctrlKey ? 0 : 2, ctrlKey: options.ctrlKey ?? false }
  fireEvent.mouseDown(element, init)
  fireEvent.contextMenu(element, init)
  fireEvent.mouseUp(element, init)
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
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-1'])
  })

  it('⇧ を伴うクリックで矩形に広がる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
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
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseEnter(screen.getByTestId('result-cell-1-0'))
    fireEvent.mouseUp(window)

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-0', 'result-cell-1-0'])
  })

  it('離した後にセルへ入っても選択は広がらない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseUp(window)

    // Act
    fireEvent.mouseEnter(screen.getByTestId('result-cell-2-1'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-0'])
  })

  it('行番号を押すと行全体が選択される', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-row-number-2'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-2-0', 'result-cell-2-1'])
  })

  it('⌘A で表示中の全行が選択される', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'a', metaKey: true })

    // Assert
    expect(選択中のセル()).toHaveLength(6)
  })

  it('矢印キーで選択が 1 セル動く', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'ArrowDown' })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
  })

  it('⇧ + 矢印で選択が伸びる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
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
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
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
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'), { shiftKey: true })

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.last()).toBe('10\tあ\n20\tい')
  })

  it('⇧⌘C では列見出しが 1 行目に付く', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
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
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-2-1'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.last()).toBe('NULL')
  })

  it('選択が無ければ ⌘C は何も書かない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.written).toEqual([])
  })

  it('右クリックでメニューが出てそのセルが選択される', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)

    // Act
    右クリック(screen.getByTestId('result-cell-1-0'))

    // Assert
    expect(screen.getByTestId('result-context-menu')).toBeInTheDocument()
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
  })

  it('メニューの「見出し付きでコピー」は列名を添える', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    右クリック(screen.getByTestId('result-cell-0-1'))

    // Act
    fireEvent.click(screen.getByText('見出し付きでコピー'))

    // Assert
    expect(クリップボード.last()).toBe('LABEL\nあ')
  })

  it('メニューの「この列をコピー」は表示中の全行を載せる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    右クリック(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.click(screen.getByText('この列をコピー'))

    // Assert
    expect(クリップボード.last()).toBe('10\n20\n30')
  })

  it('複数行×複数列を選んだまま右クリックの「コピー」で範囲のセルがすべて載る', () => {
    // Arrange: 3 行 × 2 列を選び、範囲の中を右クリックする
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseDown(screen.getByTestId('result-cell-2-1'), { shiftKey: true })
    右クリック(screen.getByTestId('result-cell-1-1'))

    // Act
    fireEvent.click(screen.getByText('コピー'))

    // Assert: 選択が保たれ、6 つのセルが行と列の形のまま載る
    expect(選択中のセル()).toHaveLength(6)
    const セル = (クリップボード.last() ?? '').split('\n').map((line) => line.split('\t'))
    expect(セル).toEqual([
      ['10', 'あ'],
      ['20', 'い'],
      ['30', 'NULL'],
    ])
  })

  it('複数行×複数列を選んだまま ⌃ + クリックの「見出し付きでコピー」で範囲のセルがすべて載る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    fireEvent.mouseDown(screen.getByTestId('result-cell-2-1'), { shiftKey: true })
    右クリック(screen.getByTestId('result-cell-2-0'), { ctrlKey: true })

    // Act
    fireEvent.click(screen.getByText('見出し付きでコピー'))

    // Assert
    const セル = (クリップボード.last() ?? '').split('\n').map((line) => line.split('\t'))
    expect(セル).toEqual([
      ['ID', 'LABEL'],
      ['10', 'あ'],
      ['20', 'い'],
      ['30', 'NULL'],
    ])
  })

  it('行番号を右クリックしても行の選択は潰れない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-row-number-0'))
    fireEvent.mouseDown(screen.getByTestId('result-row-number-1'), { shiftKey: true })

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-row-number-2'), { button: 2 })

    // Assert
    expect(選択中のセル()).toHaveLength(4)
  })

  it('セルを選んだ後の ⌘A で全セルが選択される', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-1'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'a', metaKey: true })

    // Assert
    expect(選択中のセル()).toHaveLength(6)
  })

  it('メニューの暗幕と項目の押し下げは表から焦点を奪わない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    右クリック(screen.getByTestId('result-cell-0-0'))

    // Act: 既定動作が止められていれば `fireEvent` は偽を返す
    const 項目の既定動作 = fireEvent.mouseDown(screen.getByText('コピー'))
    const 暗幕の既定動作 = fireEvent.mouseDown(screen.getByTestId('result-context-menu-backdrop'))

    // Assert
    expect(項目の既定動作).toBe(false)
    expect(暗幕の既定動作).toBe(false)
  })

  it('メニューの外を押すと閉じる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={選択用の結果} onRequestMore={() => {}} />)
    右クリック(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-context-menu-backdrop'))

    // Assert
    expect(screen.queryByTestId('result-context-menu')).not.toBeInTheDocument()
  })
})

describe('ResultTable の列幅と詳細表示', () => {
  it('見出しの右端をドラッグすると列幅が変わる', () => {
    // Arrange: ID は既定の 110px で描かれている
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    const つまみ = screen.getByLabelText('ID の列幅を変える')

    // Act: 右へ 50px 引く
    fireEvent.mouseDown(つまみ, { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)

    // Assert
    expect(useUiStore.getState().resultColumnWidths['tab-1'].ID).toBe(160)
    const header = screen.getByTestId('result-table-header').firstElementChild as HTMLElement
    expect(header.style.minWidth).toBe('364px')
  })

  it('マウスを離した後はドラッグが続かない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    const つまみ = screen.getByLabelText('ID の列幅を変える')
    fireEvent.mouseDown(つまみ, { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)

    // Act
    fireEvent.mouseMove(window, { clientX: 300 })

    // Assert
    expect(useUiStore.getState().resultColumnWidths['tab-1'].ID).toBe(160)
  })

  it('下限より狭くは縮まない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    const つまみ = screen.getByLabelText('ID の列幅を変える')

    // Act: 左へ大きく引く
    fireEvent.mouseDown(つまみ, { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: -500 })
    fireEvent.mouseUp(window)

    // Assert
    expect(useUiStore.getState().resultColumnWidths['tab-1'].ID).toBe(48)
  })

  it('列幅のドラッグはセル選択を起こさない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByLabelText('ID の列幅を変える'), { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)

    // Assert
    expect(選択中のセル()).toEqual([])
  })

  it('見出しをダブルクリックすると取得済みの行に合わせた幅になる', () => {
    // Arrange: 全角 6 文字（半角 12 文字ぶん）の値を 1 行だけ持つ
    const メモの結果: TabExecution = {
      ...結果,
      columns: [{ name: 'NOTE', typeName: 'VARCHAR2(400)', kind: 'text' }],
      rows: [[{ text: '日本語のメモ', kind: 'text' }]],
    }
    render(<ResultTable tabId="tab-1" execution={メモの結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.doubleClick(screen.getByText('NOTE'))

    // Assert: 12 文字 × 6.072px + 余白 19px
    expect(useUiStore.getState().resultColumnWidths['tab-1'].NOTE).toBe(92)
  })

  it('列幅は列名をキーに覚えるので実行し直しても保たれる', () => {
    // Arrange
    const { rerender } = render(
      <ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />,
    )
    fireEvent.mouseDown(screen.getByLabelText('ID の列幅を変える'), { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)

    // Act: 同じ列名で行だけが入れ替わった結果に差し替える
    const 再実行: TabExecution = {
      ...結果,
      rows: [
        [
          { text: '99', kind: 'number' },
          { text: 'x', kind: 'text' },
        ],
      ],
    }
    rerender(<ResultTable tabId="tab-1" execution={再実行} onRequestMore={() => {}} />)

    // Assert
    const header = screen.getByTestId('result-table-header').firstElementChild as HTMLElement
    expect(header.style.minWidth).toBe('364px')
  })

  it('列幅はタブごとに別々に覚える', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByLabelText('ID の列幅を変える'), { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)

    // Act
    render(<ResultTable tabId="tab-2" execution={結果} onRequestMore={() => {}} />)

    // Assert: 別のタブは既定の幅のまま
    const headers = screen.getAllByTestId('result-table-header')
    expect((headers[1].firstElementChild as HTMLElement).style.minWidth).toBe('314px')
  })

  it('セルをダブルクリックすると詳細パネルが開く', () => {
    // Arrange
    const 長い値: TabExecution = {
      ...結果,
      columns: [{ name: 'NOTE', typeName: 'CLOB', kind: 'text' }],
      rows: [[{ text: '全文がここに出る', kind: 'text' }]],
    }
    render(<ResultTable tabId="tab-1" execution={長い値} onRequestMore={() => {}} />)

    // Act
    fireEvent.doubleClick(screen.getByTestId('result-cell-0-0'))

    // Assert
    const panel = screen.getByTestId('cell-detail-panel')
    expect(panel).toHaveTextContent('CLOB')
    expect(panel).toHaveTextContent('全文がここに出る')
  })

  it('ダブルクリックしたセルは選択もされる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-0'))
    fireEvent.doubleClick(screen.getByTestId('result-cell-1-0'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-0'])
    expect(screen.getByTestId('cell-detail-panel')).toBeInTheDocument()
  })

  it('詳細パネルは esc で閉じる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.doubleClick(screen.getByTestId('result-cell-0-0'))
    expect(screen.getByTestId('cell-detail-panel')).toBeInTheDocument()

    // Act
    fireEvent.keyDown(window, { key: 'Escape' })

    // Assert
    expect(screen.queryByTestId('cell-detail-panel')).not.toBeInTheDocument()
  })

  it('詳細パネルを閉じるボタンで閉じると焦点が表へ戻る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.doubleClick(screen.getByTestId('result-cell-0-0'))
    const 閉じる = screen.getByLabelText('詳細を閉じる')
    閉じる.focus()

    // Act
    fireEvent.click(閉じる)

    // Assert
    expect(document.activeElement).toBe(screen.getByTestId('result-table-body'))
  })

  it('右クリックのメニューは詳細パネルを開いていても出る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.doubleClick(screen.getByTestId('result-cell-0-0'))

    // Act
    右クリック(screen.getByTestId('result-cell-0-1'))

    // Assert
    expect(screen.getByTestId('result-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('cell-detail-panel')).toBeInTheDocument()
  })
})

/** 検索バーを開いて語を打つ。 */
function 検索する(語: string) {
  fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })
  fireEvent.change(screen.getByLabelText('表示中の結果を検索'), { target: { value: 語 } })
}

/** 当たりとして塗られているセルの testid を並べる。 */
function 当たりのセル(): string[] {
  return [...document.querySelectorAll('[data-match="true"]')].map(
    (element) => element.getAttribute('data-testid') ?? '',
  )
}

describe('ResultTable の検索', () => {
  /** 4 行 2 列。`ORDERS` を 2 行、`orders` を 1 行含む。 */
  const 検索用の結果: TabExecution = {
    ...emptyExecution,
    status: 'succeeded',
    columns: [
      { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
      { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
    ],
    rows: [
      [
        { text: '10', kind: 'number' },
        { text: 'ORDERS', kind: 'text' },
      ],
      [
        { text: '20', kind: 'number' },
        { text: 'ITEMS', kind: 'text' },
      ],
      [
        { text: '30', kind: 'number' },
        { text: 'orders', kind: 'text' },
      ],
      [
        { text: '40', kind: 'number' },
        { text: '', kind: 'null' },
      ],
    ],
    exhausted: true,
    elapsedMs: 12,
  }

  it('⌘F で検索バーが開く', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })

    // Assert
    expect(screen.getByTestId('result-search-bar')).toBeInTheDocument()
  })

  it('⇧⌘F では検索バーを開かない', () => {
    // Arrange: ⇧⌘F はオブジェクトのソース検索（ADR 0021）である
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), {
      key: 'f',
      metaKey: true,
      shiftKey: true,
    })

    // Assert
    expect(screen.queryByTestId('result-search-bar')).not.toBeInTheDocument()
  })

  it('検索バーは開くまで出ない', () => {
    // Arrange & Act
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.queryByTestId('result-search-bar')).not.toBeInTheDocument()
  })

  it('当たったセルがすべて塗られる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act: 既定では大文字と小文字を区別しない
    検索する('orders')

    // Assert
    expect(当たりのセル()).toEqual(['result-cell-0-1', 'result-cell-2-1'])
  })

  it('語を打つと 1 件目へ選択が飛ぶ', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    検索する('orders')

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-1'])
  })

  it('⏎ で次の当たりへ進む', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), { key: 'Enter' })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-2-1'])
  })

  it('末尾の次は先頭へ巻き戻る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')
    const 欄 = screen.getByLabelText('表示中の結果を検索')
    fireEvent.keyDown(欄, { key: 'Enter' })

    // Act
    fireEvent.keyDown(欄, { key: 'Enter' })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-1'])
  })

  it('⇧⏎ で前の当たりへ戻る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), {
      key: 'Enter',
      shiftKey: true,
    })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-2-1'])
  })

  it('⌘G でも次の当たりへ進む', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'g', metaKey: true })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-2-1'])
  })

  it('変換中の ⏎ では当たりが進まない', () => {
    // Arrange: 変換を確定する ⏎ は keyCode 229 で届く（ADR 0025）
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), {
      key: 'Enter',
      keyCode: 229,
    })

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-0-1'])
  })

  it('変換中の esc では検索バーが閉じない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), {
      key: 'Escape',
      isComposing: true,
    })

    // Assert
    expect(screen.getByTestId('result-search-bar')).toBeInTheDocument()
  })

  it('esc で検索バーが閉じる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), { key: 'Escape' })

    // Assert
    expect(screen.queryByTestId('result-search-bar')).not.toBeInTheDocument()
  })

  it('大文字と小文字を区別すると綴りの違うものは外れる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act
    fireEvent.click(screen.getByLabelText('大文字と小文字を区別'))

    // Assert
    expect(当たりのセル()).toEqual(['result-cell-2-1'])
  })

  it('NULL のセルは NULL という語で拾える', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    検索する('null')

    // Assert
    expect(当たりのセル()).toEqual(['result-cell-3-1'])
  })

  it('カーソルが尽きていれば件数だけを出す', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    検索する('orders')

    // Assert
    expect(screen.getByTestId('result-search-summary')).toHaveTextContent('1 / 2 件')
  })

  it('カーソルが尽きていなければ探した行数を必ず添える', () => {
    // Arrange: 4 行だけ取得済みで、まだ続きがある
    const 途中の結果: TabExecution = { ...検索用の結果, exhausted: false }
    render(<ResultTable tabId="tab-1" execution={途中の結果} onRequestMore={() => {}} />)

    // Act
    検索する('orders')

    // Assert
    expect(screen.getByTestId('result-search-summary')).toHaveTextContent(
      '1 / 2 件（取得済みの 4 行のうち）',
    )
  })

  it('カーソルが尽きていれば残りを読み込むボタンは出ない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    検索する('orders')

    // Assert
    expect(screen.queryByText('残りを読み込んで探す')).not.toBeInTheDocument()
  })

  it('残りを読み込むボタンで続きを要求する', () => {
    // Arrange
    const 途中の結果: TabExecution = { ...検索用の結果, exhausted: false }
    const 要求 = vi.fn()
    render(<ResultTable tabId="tab-1" execution={途中の結果} onRequestMore={要求} />)
    検索する('orders')
    要求.mockClear()

    // Act
    fireEvent.click(screen.getByText('残りを読み込んで探す'))

    // Assert
    expect(要求).toHaveBeenCalled()
  })

  it('読み込みは押し直すと止まる', () => {
    // Arrange
    const 途中の結果: TabExecution = { ...検索用の結果, exhausted: false }
    render(<ResultTable tabId="tab-1" execution={途中の結果} onRequestMore={() => {}} />)
    検索する('orders')
    fireEvent.click(screen.getByText('残りを読み込んで探す'))

    // Act
    fireEvent.click(screen.getByText('読み込みを止める'))

    // Assert
    expect(screen.getByText('残りを読み込んで探す')).toBeInTheDocument()
  })

  it('切り詰められた値を探したときは断り書きが出る', () => {
    // Arrange: CLOB が 64KB で切れているセルを含む結果
    const 切れた結果: TabExecution = {
      ...検索用の結果,
      columns: [{ name: 'NOTE', typeName: 'CLOB', kind: 'text' }],
      rows: [[{ text: '長い本文', kind: 'text', truncated: true }]],
    }
    render(<ResultTable tabId="tab-1" execution={切れた結果} onRequestMore={() => {}} />)

    // Act
    検索する('本文')

    // Assert
    expect(screen.getByText('一部の値は先頭 64 KB までしか探していません')).toBeInTheDocument()
  })

  it('切り詰めが無ければ断り書きは出ない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)

    // Act
    検索する('orders')

    // Assert
    expect(screen.queryByText(/先頭 64 KB/)).not.toBeInTheDocument()
  })

  it('続きの行が届いても今いる当たりは動かない', () => {
    // Arrange
    const 途中の結果: TabExecution = { ...検索用の結果, exhausted: false }
    const { rerender } = render(
      <ResultTable tabId="tab-1" execution={途中の結果} onRequestMore={() => {}} />,
    )
    検索する('orders')
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), { key: 'Enter' })

    // Act: 既にある行はそのままに、当たりを 1 つ含む行が後ろへ足される
    const 続き: TabExecution = {
      ...途中の結果,
      rows: [
        ...途中の結果.rows,
        [
          { text: '50', kind: 'number' },
          { text: 'ORDERS', kind: 'text' },
        ],
      ],
    }
    rerender(<ResultTable tabId="tab-1" execution={続き} onRequestMore={() => {}} />)

    // Assert: 2 件目に居たまま、総数だけが増える
    expect(選択中のセル()).toEqual(['result-cell-2-1'])
    expect(screen.getByTestId('result-search-summary')).toHaveTextContent(
      '2 / 3 件（取得済みの 5 行のうち）',
    )
  })

  it('矢印キーの移動は当たりとは別に動く', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    検索する('orders')

    // Act: 選択だけを 1 つ下へ動かす
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'ArrowDown' })

    // Assert: 選択は動くが、当たりの塗りはそのまま残る
    expect(選択中のセル()).toEqual(['result-cell-1-1'])
    expect(当たりのセル()).toEqual(['result-cell-0-1', 'result-cell-2-1'])
  })
})

describe('ResultTable の検索を閉じたあと', () => {
  const 検索用の結果: TabExecution = {
    ...emptyExecution,
    status: 'succeeded',
    columns: [{ name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' }],
    rows: [[{ text: 'ORDERS', kind: 'text' }]],
    exhausted: true,
    elapsedMs: 12,
  }

  it('閉じると当たりの塗りが消える', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })
    fireEvent.change(screen.getByLabelText('表示中の結果を検索'), {
      target: { value: 'orders' },
    })

    // Act
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), { key: 'Escape' })

    // Assert
    expect(当たりのセル()).toEqual([])
  })

  it('開き直すと語がそのまま残っている', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={検索用の結果} onRequestMore={() => {}} />)
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })
    fireEvent.change(screen.getByLabelText('表示中の結果を検索'), {
      target: { value: 'orders' },
    })
    fireEvent.keyDown(screen.getByLabelText('表示中の結果を検索'), { key: 'Escape' })

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })

    // Assert
    expect(screen.getByLabelText('表示中の結果を検索')).toHaveValue('orders')
    expect(当たりのセル()).toEqual(['result-cell-0-0'])
  })
})

describe('ResultTable の見出しと行番号の右クリック（ADR 0038）', () => {
  let クリップボード: FakeClipboard

  beforeEach(() => {
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
  })

  it('見出しの「列名をコピー」は列名だけを写し、選択は動かさない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))
    右クリック(screen.getByText('LABEL'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: '列名をコピー' }))

    // Assert
    expect(クリップボード.last()).toBe('LABEL')
    expect(選択中のセル()).toEqual(['result-cell-0-0'])
    expect(screen.queryByTestId('result-header-context-menu')).not.toBeInTheDocument()
  })

  it('見出しの「この列をコピー」はその列の全行を写す', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    右クリック(screen.getByText('ID'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: 'この列をコピー' }))

    // Assert
    expect(クリップボード.last()).toBe('10\n20')
  })

  it('見出しの「列幅を内容に合わせる」はダブルクリックと同じ幅を覚える', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.doubleClick(screen.getByText('LABEL'))
    const ダブルクリックの幅 = useUiStore.getState().resultColumnWidths['tab-1']?.LABEL
    useUiStore.setState({ resultColumnWidths: {} })
    右クリック(screen.getByText('LABEL'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: '列幅を内容に合わせる' }))

    // Assert
    expect(ダブルクリックの幅).toBeDefined()
    expect(useUiStore.getState().resultColumnWidths['tab-1']?.LABEL).toBe(ダブルクリックの幅)
  })

  it('行番号を右クリックするとその行全体を選び、列のコピーは出さない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Act
    右クリック(screen.getByTestId('result-row-number-1'))

    // Assert
    expect(選択中のセル()).toEqual(['result-cell-1-0', 'result-cell-1-1'])
    expect(screen.getByTestId('result-context-menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'この列をコピー' })).not.toBeInTheDocument()
  })

  it('行番号のメニューの「コピー」は選んだ行を写す', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    右クリック(screen.getByTestId('result-row-number-0'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: 'コピー' }))

    // Assert
    expect(クリップボード.last()).toBe('10\t')
  })
})

describe('ResultTable の列の固定（ADR 0048）', () => {
  it('見出しの「この列まで固定」でその列までと行番号が横スクロールから外れる', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    右クリック(screen.getByText('ID'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: 'この列まで固定' }))

    // Assert
    expect(useUiStore.getState().resultFrozenColumns['tab-1']).toEqual({ name: 'ID', index: 0 })
    expect(screen.getByTestId('result-cell-0-0')).toHaveStyle({ position: 'sticky', left: '44px' })
    expect(screen.getByTestId('result-row-number-0')).toHaveStyle({
      position: 'sticky',
      left: '0px',
    })
    expect(screen.getByTestId('result-cell-0-1')).not.toHaveAttribute('data-frozen')
    expect(screen.getByText('ID').closest('[data-frozen]')).not.toBeNull()
  })

  it('固定していなければ行番号も貼り付かない', () => {
    // Arrange
    // 固定なし

    // Act
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByTestId('result-row-number-0')).not.toHaveStyle({ position: 'sticky' })
    expect(screen.queryAllByTestId(/result-cell-/).some((cell) => cell.dataset.frozen)).toBe(false)
  })

  it('固定した境目の列では「この列まで固定」を出さず「列の固定を解除」で外せる', () => {
    // Arrange
    useUiStore.setState({ resultFrozenColumns: { 'tab-1': { name: 'LABEL', index: 1 } } })
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    右クリック(screen.getByText('LABEL'))

    // Act
    const 固定の項目 = screen.queryByRole('menuitem', { name: 'この列まで固定' })
    fireEvent.click(screen.getByRole('menuitem', { name: '列の固定を解除' }))

    // Assert
    expect(固定の項目).not.toBeInTheDocument()
    expect(useUiStore.getState().resultFrozenColumns).toEqual({})
    expect(screen.getByTestId('result-cell-0-1')).not.toHaveAttribute('data-frozen')
  })

  it('何も固定していなければ「列の固定を解除」は出ない', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)

    // Act
    右クリック(screen.getByText('ID'))

    // Assert
    expect(screen.queryByRole('menuitem', { name: '列の固定を解除' })).not.toBeInTheDocument()
  })

  it('固定した列のセルも選択とコピーは同じ位置のまま効く', async () => {
    // Arrange
    const クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
    useUiStore.setState({ resultFrozenColumns: { 'tab-1': { name: 'ID', index: 0 } } })
    render(<ResultTable tabId="tab-1" execution={結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-1-0'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.last()).toBe('20')
    resetClipboardApi()
  })
})

describe('ResultTable の表示調整（ADR 0048）', () => {
  /** 桁の多い数値と前後に空白のある文字列。 */
  const 調整用の結果: TabExecution = {
    ...結果,
    rows: [
      [
        { text: '1234567', kind: 'number' },
        { text: ' A\tB ', kind: 'text' },
      ],
    ],
  }
  let クリップボード: FakeClipboard

  beforeEach(() => {
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
  })

  it('3 桁区切りは描く文字だけを変えコピーは元の値を写す', () => {
    // Arrange
    useUiStore.setState({ resultDisplayOverrides: { 'tab-1': { thousandsSeparator: true } } })
    render(<ResultTable tabId="tab-1" execution={調整用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(screen.getByTestId('result-cell-0-0')).toHaveTextContent('1,234,567')
    expect(クリップボード.last()).toBe('1234567')
  })

  it('空白の記号は描く文字だけを変えコピーは元の値を写す', () => {
    // Arrange
    useUiStore.setState({
      resultDisplayDefaults: { thousandsSeparator: false, showWhitespace: true },
    })
    render(<ResultTable tabId="tab-1" execution={調整用の結果} onRequestMore={() => {}} />)
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-1'))

    // Act
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'c', metaKey: true })

    // Assert
    expect(screen.getByTestId('result-cell-0-1')).toHaveTextContent('·A→B·')
    expect(クリップボード.last()).toBe(' A\tB ')
  })

  it('別のタブの表示調整はこのタブに効かない', () => {
    // Arrange
    useUiStore.setState({ resultDisplayOverrides: { 'tab-2': { thousandsSeparator: true } } })

    // Act
    render(<ResultTable tabId="tab-1" execution={調整用の結果} onRequestMore={() => {}} />)

    // Assert
    expect(screen.getByTestId('result-cell-0-0')).toHaveTextContent('1234567')
  })

  it('区切りを入れた表では区切りの付いた語で探して当たる', () => {
    // Arrange
    useUiStore.setState({ resultDisplayOverrides: { 'tab-1': { thousandsSeparator: true } } })
    render(<ResultTable tabId="tab-1" execution={調整用の結果} onRequestMore={() => {}} />)
    fireEvent.keyDown(screen.getByTestId('result-table-body'), { key: 'f', metaKey: true })

    // Act
    fireEvent.change(screen.getByLabelText('表示中の結果を検索'), { target: { value: '4,567' } })

    // Assert
    expect(screen.getByTestId('result-cell-0-0')).toHaveAttribute('data-match', 'true')
  })

  it('内容に合わせた列幅は区切りを入れた文字で測る', () => {
    // Arrange
    render(<ResultTable tabId="tab-1" execution={調整用の結果} onRequestMore={() => {}} />)
    fireEvent.doubleClick(screen.getByText('ID'))
    const 値の幅 = useUiStore.getState().resultColumnWidths['tab-1']?.ID ?? 0
    act(() => {
      useUiStore.setState({
        resultColumnWidths: {},
        resultDisplayOverrides: { 'tab-1': { thousandsSeparator: true } },
      })
    })

    // Act
    fireEvent.doubleClick(screen.getByText('ID'))

    // Assert
    expect(useUiStore.getState().resultColumnWidths['tab-1']?.ID).toBeGreaterThan(値の幅)
  })
})
