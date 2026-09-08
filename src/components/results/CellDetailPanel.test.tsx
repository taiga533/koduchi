import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CellDetailPanel } from './CellDetailPanel'
import type { Column } from '../../types/db'

/** JSON を保持する CLOB の列。 */
const JSON列: Column = { name: 'PAYLOAD', typeName: 'CLOB', kind: 'text' }

describe('CellDetailPanel', () => {
  it('列の型名と行番号と文字数を添える', () => {
    // Arrange
    const cell = { text: 'abcde', kind: 'text' as const }

    // Act
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={7} onClose={() => {}} />)

    // Assert
    const panel = screen.getByTestId('cell-detail-panel')
    expect(panel).toHaveTextContent('CLOB')
    expect(panel).toHaveTextContent('7 行目')
    expect(panel).toHaveTextContent('5 文字')
  })

  it('JSON らしき値は既定で整形して出す', () => {
    // Arrange
    const cell = { text: '{"id":1}', kind: 'text' as const }

    // Act
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={() => {}} />)

    // Assert
    expect(screen.getByTestId('cell-detail-body').textContent).toBe('{\n  "id": 1\n}')
  })

  it('整形を切ると生の値に戻る', () => {
    // Arrange
    const cell = { text: '{"id":1}', kind: 'text' as const }
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={() => {}} />)

    // Act
    fireEvent.click(screen.getByLabelText('JSON として整形する'))

    // Assert
    expect(screen.getByTestId('cell-detail-body').textContent).toBe('{"id":1}')
  })

  it('JSON でない値には整形の切替を出さない', () => {
    // Arrange
    const cell = { text: 'ORD-0001', kind: 'text' as const }

    // Act
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={() => {}} />)

    // Assert
    expect(screen.queryByLabelText('JSON として整形する')).not.toBeInTheDocument()
  })

  it('折り返しを切ると折り返さない指定に変わる', () => {
    // Arrange
    const cell = { text: 'x'.repeat(200), kind: 'text' as const }
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={() => {}} />)
    expect(screen.getByTestId('cell-detail-body').className).toContain('whitespace-pre-wrap')

    // Act
    fireEvent.click(screen.getByLabelText('折り返しを切り替える'))

    // Assert
    const body = screen.getByTestId('cell-detail-body')
    expect(body.className).toContain('whitespace-pre')
    expect(body.className).not.toContain('whitespace-pre-wrap')
  })

  it('BLOB は中身を出せない旨を書く', () => {
    // Arrange
    const 列: Column = { name: 'DATA', typeName: 'BLOB', kind: 'binary' }
    const cell = { text: '[BLOB 1.2 KB]', kind: 'binary' as const }

    // Act
    render(<CellDetailPanel column={列} cell={cell} rowNumber={1} onClose={() => {}} />)

    // Assert
    expect(screen.getByTestId('cell-detail-panel')).toHaveTextContent(
      '[BLOB 1.2 KB] の中身は取得していません',
    )
    expect(screen.queryByTestId('cell-detail-body')).not.toBeInTheDocument()
  })

  it('NULL は文字数ではなく値なしと書く', () => {
    // Arrange
    const cell = { text: '', kind: 'null' as const }

    // Act
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={() => {}} />)

    // Assert
    expect(screen.getByTestId('cell-detail-panel')).toHaveTextContent('値なし（NULL）')
  })

  it('esc で閉じる', () => {
    // Arrange
    const 閉じる = vi.fn()
    const cell = { text: 'abc', kind: 'text' as const }
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={閉じる} />)

    // Act
    fireEvent.keyDown(window, { key: 'Escape' })

    // Assert
    expect(閉じる).toHaveBeenCalledTimes(1)
  })

  it('閉じるボタンで閉じる', () => {
    // Arrange
    const 閉じる = vi.fn()
    const cell = { text: 'abc', kind: 'text' as const }
    render(<CellDetailPanel column={JSON列} cell={cell} rowNumber={1} onClose={閉じる} />)

    // Act
    fireEvent.click(screen.getByLabelText('詳細を閉じる'))

    // Assert
    expect(閉じる).toHaveBeenCalledTimes(1)
  })
})

describe('CellDetailPanel の IME 対応（ADR 0025）', () => {
  it('変換中の esc では詳細を閉じない', () => {
    // Arrange
    const onClose = vi.fn()
    render(
      <CellDetailPanel
        column={JSON列}
        cell={{ kind: 'text', text: '{"a":1}' }}
        rowNumber={1}
        onClose={onClose}
      />,
    )

    // Act
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })

    // Assert
    expect(onClose).not.toHaveBeenCalled()
  })

  it('変換していないときの esc は今までどおり詳細を閉じる', () => {
    // Arrange
    const onClose = vi.fn()
    render(
      <CellDetailPanel
        column={JSON列}
        cell={{ kind: 'text', text: '{"a":1}' }}
        rowNumber={1}
        onClose={onClose}
      />,
    )

    // Act
    fireEvent.keyDown(window, { key: 'Escape' })

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
