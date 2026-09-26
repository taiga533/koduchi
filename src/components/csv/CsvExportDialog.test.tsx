import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CsvExportScreen } from '../../mediator/csv'
import { CsvExportDialog } from './CsvExportDialog'

/** 渡された口を控えるだけの書き出し。裁定は仲介者の側にあるため、ここでは差し替える。 */
function 控える書き出し(): {
  onExport: (screen: CsvExportScreen) => Promise<void>
  渡された: CsvExportScreen[]
} {
  const 渡された: CsvExportScreen[] = []
  return {
    渡された,
    onExport: async (口) => {
      渡された.push(口)
    },
  }
}

describe('CsvExportDialog', () => {
  it('保存先を選ぶと書き出しを報告し、報された進み具合を出す', async () => {
    // Arrange
    const { onExport, 渡された } = 控える書き出し()
    render(<CsvExportDialog onExport={onExport} onClose={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存先を選ぶ' }))
    act(() => 渡された[0].report({ rows: 1200, done: false, error: null }))

    // Assert
    expect(渡された).toHaveLength(1)
    expect(screen.getByText('1,200 行を書き出し中…')).toBeInTheDocument()
  })

  it('中止を押すと書き出しの側から中止されたと読める', async () => {
    // Arrange
    const { onExport, 渡された } = 控える書き出し()
    render(<CsvExportDialog onExport={onExport} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '保存先を選ぶ' }))
    act(() => 渡された[0].report({ rows: 0, done: false, error: null }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: '中止' }))

    // Assert
    expect(渡された[0].isCancelled()).toBe(true)
  })

  it('閉じると中止の印を立ててから閉じたことを報告する', async () => {
    // Arrange
    const { onExport, 渡された } = 控える書き出し()
    let 閉じた = 0
    render(
      <CsvExportDialog
        onExport={onExport}
        onClose={() => {
          閉じた += 1
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存先を選ぶ' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存をやめる' }))

    // Assert
    expect(閉じた).toBe(1)
    expect(渡された[0].isCancelled()).toBe(true)
  })

  it('もう一度始めると前回の中止の印を持ち越さない', async () => {
    // Arrange
    const { onExport, 渡された } = 控える書き出し()
    render(<CsvExportDialog onExport={onExport} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '保存先を選ぶ' }))
    act(() => 渡された[0].report({ rows: 0, done: false, error: null }))
    await userEvent.click(screen.getByRole('button', { name: '中止' }))
    act(() => 渡された[0].report({ rows: 0, done: true, error: '書き出しを中止しました' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'もう一度保存' }))

    // Assert
    expect(渡された).toHaveLength(2)
    expect(渡された[1].isCancelled()).toBe(false)
  })
})
