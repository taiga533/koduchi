import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CsvOptions } from '../../types/db'
import { defaultCsvOptions } from '../../types/db'
import { CsvSaveDialog } from './CsvSaveDialog'

/** 既定の props でダイアログを描く。 */
function 描く(overrides: Partial<React.ComponentProps<typeof CsvSaveDialog>> = {}) {
  const props = {
    options: defaultCsvOptions,
    onChange: () => {},
    progress: null,
    onStart: () => {},
    onCancel: () => {},
    onClose: () => {},
    ...overrides,
  }
  render(<CsvSaveDialog {...props} />)
  return props
}

describe('CsvSaveDialog', () => {
  it('既定はカンマと bom 付き utf-8 と空欄である', () => {
    // Arrange
    描く()

    // Act
    const 区切り = screen.getByLabelText('カンマ') as HTMLInputElement
    const 文字コード = screen.getByLabelText('UTF-8 (BOM 付き)') as HTMLInputElement
    const null表現 = screen.getByLabelText('空欄') as HTMLInputElement

    // Assert
    expect(区切り.checked).toBe(true)
    expect(文字コード.checked).toBe(true)
    expect(null表現.checked).toBe(true)
  })

  it('区切り文字を選ぶと書式が変わる', async () => {
    // Arrange
    const 変更: CsvOptions[] = []
    描く({ onChange: (options) => 変更.push(options) })

    // Act
    await userEvent.click(screen.getByLabelText('タブ'))

    // Assert
    expect(変更[0].delimiter).toBe('tab')
  })

  it('null の表現を選ぶと書式が変わる', async () => {
    // Arrange
    const 変更: CsvOptions[] = []
    描く({ onChange: (options) => 変更.push(options) })

    // Act
    await userEvent.click(screen.getByLabelText('NULL'))

    // Assert
    expect(変更[0].nullText).toBe('word')
  })

  it('保存先を選ぶと書き出しが始まる', async () => {
    // Arrange
    let 始まった = false
    描く({ onStart: () => (始まった = true) })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存先を選ぶ' }))

    // Assert
    expect(始まった).toBe(true)
  })

  it('書き出し中は行数を出して中止できる', async () => {
    // Arrange
    let 中止した = false
    描く({
      progress: { rows: 1200, done: false, error: null },
      onCancel: () => (中止した = true),
    })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '中止' }))

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('1,200 行を書き出し中…')
    expect(中止した).toBe(true)
  })

  it('終わると書き出した行数を出す', () => {
    // Arrange
    描く({ progress: { rows: 50000, done: true, error: null } })

    // Act
    const 表示 = screen.getByRole('status')

    // Assert
    expect(表示).toHaveTextContent('50,000 行を書き出しました')
  })

  it('失敗するとその内容を出す', () => {
    // Arrange
    描く({ progress: { rows: 0, done: true, error: '書き出しを中止しました' } })

    // Act
    const 表示 = screen.getByRole('status')

    // Assert
    expect(表示).toHaveTextContent('書き出しを中止しました')
  })
})

describe('CsvSaveDialog の切り詰めの知らせ', () => {
  it('切り詰められたまま書き出したセルがあれば数を伝える', () => {
    // Arrange & Act
    描く({ progress: { rows: 1000, done: true, error: null, truncatedCells: 3 } })

    // Assert
    expect(screen.getByTestId('csv-truncated-notice')).toHaveTextContent('3 個のセル')
    expect(screen.getByTestId('csv-truncated-notice')).toHaveTextContent('64 KB')
  })

  it('切り詰められたセルが無ければ知らせを出さない', () => {
    // Arrange & Act
    描く({ progress: { rows: 1000, done: true, error: null, truncatedCells: 0 } })

    // Assert
    expect(screen.queryByTestId('csv-truncated-notice')).not.toBeInTheDocument()
  })

  it('書き出し中はまだ知らせを出さない', () => {
    // Arrange & Act
    描く({ progress: { rows: 500, done: false, error: null, truncatedCells: 2 } })

    // Assert
    expect(screen.queryByTestId('csv-truncated-notice')).not.toBeInTheDocument()
  })
})
