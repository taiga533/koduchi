/**
 * 選んだセルの集計の表示のテスト（ADR 0049）。
 *
 * 結果テーブルとステータスバーの集計を並べて描き、表で選んだものが集計のストアを
 * 通ってフッターに出るまでを見る。表の中の選択はストアへ出していないため、この道が
 * 唯一の受け渡しである。
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultTable } from '../results/ResultTable'
import { SelectionStatsView } from './SelectionStatsView'
import { emptyExecution, type TabExecution } from '../../stores/execution'
import { useSelectionStatsStore } from '../../stores/selectionStats'

// jsdom は寸法を持たず、仮想スクロールが行を描かない。寸法だけを補う。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  })
})

afterEach(() => {
  useSelectionStatsStore.setState({ stats: null, kind: 'sum' })
})

/** 数値の列と文字列の列を持つ 3 行の結果。 */
function 結果(exhausted = true): TabExecution {
  return {
    ...emptyExecution,
    status: 'succeeded',
    columns: [
      { name: 'AMOUNT', typeName: 'NUMBER', kind: 'number' },
      { name: 'LABEL', typeName: 'VARCHAR2(10)', kind: 'text' },
    ],
    rows: [
      [
        { text: '1500', kind: 'number' },
        { text: 'a', kind: 'text' },
      ],
      [
        { text: '0.25', kind: 'number' },
        { text: 'b', kind: 'text' },
      ],
      [
        { text: '', kind: 'null' },
        { text: 'c', kind: 'text' },
      ],
    ],
    exhausted,
    elapsedMs: 3,
  }
}

/**
 * 表と集計を並べて描く。
 *
 * @param execution 表に出す結果
 */
function 描く(execution: TabExecution) {
  return render(
    <>
      <ResultTable tabId="tab-1" execution={execution} onRequestMore={() => {}} />
      <SelectionStatsView />
    </>,
  )
}

/**
 * 左上から右下までをドラッグせずに選ぶ（押して `⇧` を伴って押す）。
 *
 * @param from 始めのセルの test id
 * @param to 終わりのセルの test id
 */
function 範囲を選ぶ(from: string, to: string) {
  fireEvent.mouseDown(screen.getByTestId(from))
  fireEvent.mouseUp(window)
  fireEvent.mouseDown(screen.getByTestId(to), { shiftKey: true })
  fireEvent.mouseUp(window)
}

describe('SelectionStatsView', () => {
  it('セルを 1 つしか選んでいなければ何も出さない', () => {
    // Arrange
    描く(結果())

    // Act
    fireEvent.mouseDown(screen.getByTestId('result-cell-0-0'))

    // Assert
    expect(screen.queryByTestId('selection-stats')).not.toBeInTheDocument()
  })

  it('選んだセルの件数と合計を 3 桁区切りで出す', async () => {
    // Arrange
    描く(結果())

    // Act
    範囲を選ぶ('result-cell-0-0', 'result-cell-2-1')

    // Assert
    expect(await screen.findByTestId('selection-count')).toHaveTextContent('6')
    expect(screen.getByTestId('selection-stat-value')).toHaveTextContent('1,500.25')
    expect(screen.getByTestId('selection-stat-value')).toHaveAttribute(
      'title',
      '数値 2 件の合計（NULL 1 件・数値でない 3 件は含みません）。',
    )
  })

  it('メニューから平均へ切り替えると平均を出す', async () => {
    // Arrange
    const user = userEvent.setup()
    描く(結果())
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')
    await screen.findByTestId('selection-stats')

    // Act
    await user.click(screen.getByRole('button', { name: /合計/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /平均/ }))

    // Assert
    expect(screen.getByTestId('selection-stat-value')).toHaveTextContent('750.125')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(useSelectionStatsStore.getState().kind).toBe('average')
  })

  it('メニューの項目には 4 つの値がすべて並ぶ', async () => {
    // Arrange
    const user = userEvent.setup()
    描く(結果())
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')
    await screen.findByTestId('selection-stats')

    // Act
    await user.click(screen.getByRole('button', { name: /合計/ }))

    // Assert
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(items).toEqual(['合計1,500.25', '平均750.125', '最小0.25', '最大1,500'])
  })

  it('esc でメニューを閉じる', async () => {
    // Arrange
    const user = userEvent.setup()
    描く(結果())
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')
    await user.click(await screen.findByRole('button', { name: /合計/ }))

    // Act
    await user.keyboard('{Escape}')

    // Assert
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('切り替えのボタンを押しても結果テーブルから焦点が抜けない', async () => {
    // Arrange
    const user = userEvent.setup()
    描く(結果())
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')
    const body = screen.getByTestId('result-table-body')
    body.focus()

    // Act
    await user.click(await screen.findByRole('button', { name: /合計/ }))

    // Assert
    expect(document.activeElement).toBe(body)
  })

  it('まだ読み込んでいない行へ続く選択には注意の印と注意文言を添える', async () => {
    // Arrange
    描く(結果(false))

    // Act
    範囲を選ぶ('result-cell-0-0', 'result-cell-2-0')

    // Assert
    const mark = await screen.findByTestId('selection-stats-partial')
    expect(mark).toHaveAttribute(
      'title',
      expect.stringContaining(
        '読み込み済みの 3 行だけの合計です。まだ読み込んでいない行は含みません。',
      ),
    )
    expect(screen.getByTestId('selection-stat-value').getAttribute('title')).toContain(
      '読み込み済みの 3 行だけ',
    )
  })

  it('最後の行に届かない選択には注意の印を出さない', async () => {
    // Arrange
    描く(結果(false))

    // Act
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')

    // Assert
    await screen.findByTestId('selection-stats')
    expect(screen.queryByTestId('selection-stats-partial')).not.toBeInTheDocument()
  })

  it('値は選んで写せる', async () => {
    // Arrange
    描く(結果())

    // Act
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')

    // Assert
    expect(await screen.findByTestId('selection-stat-value')).toHaveClass('select-text')
    expect(screen.getByTestId('selection-count')).toHaveClass('select-text')
  })

  it('結果テーブルが消えたら集計も消える', async () => {
    // Arrange
    const { rerender } = 描く(結果())
    範囲を選ぶ('result-cell-0-0', 'result-cell-1-0')
    await screen.findByTestId('selection-stats')

    // Act
    rerender(<SelectionStatsView />)

    // Assert
    expect(screen.queryByTestId('selection-stats')).not.toBeInTheDocument()
  })

  it('数値の無い選択では値の代わりに印を出す', async () => {
    // Arrange
    描く(結果())

    // Act
    範囲を選ぶ('result-cell-0-1', 'result-cell-1-1')

    // Assert
    expect(await screen.findByTestId('selection-stat-value')).toHaveTextContent('—')
  })
})
