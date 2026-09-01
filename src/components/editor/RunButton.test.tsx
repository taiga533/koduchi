import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RunButton } from './RunButton'

/** 既定の props でボタンを描く。押された操作を記録して返す。 */
function 描く(overrides: Partial<React.ComponentProps<typeof RunButton>> = {}) {
  const 押された: string[] = []
  const props: React.ComponentProps<typeof RunButton> = {
    running: false,
    hasSelection: false,
    onRun: () => 押された.push('run'),
    onRunSelection: () => 押された.push('runSelection'),
    onExplain: () => 押された.push('explain'),
    onExplainActual: () => 押された.push('explainActual'),
    onSaveCsv: () => 押された.push('saveCsv'),
    onCancel: () => 押された.push('cancel'),
    ...overrides,
  }
  render(<RunButton {...props} />)
  return 押された
}

describe('RunButton', () => {
  it('実行を押すと実行が呼ばれる', async () => {
    // Arrange
    const 押された = 描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    expect(押された).toEqual(['run'])
  })

  it('実行中は中止に入れ替わる', () => {
    // Arrange
    描く({ running: true })

    // Act
    const 実行 = screen.queryByRole('button', { name: '実行' })

    // Assert
    expect(実行).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '中止' })).toBeInTheDocument()
  })

  it('中止を押すと中止が呼ばれる', async () => {
    // Arrange
    const 押された = 描く({ running: true })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '中止' }))

    // Assert
    expect(押された).toEqual(['cancel'])
  })

  it('メニューには実行にまつわる操作が並ぶ', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))

    // Assert
    for (const label of [
      '選択範囲のみ実行',
      '実行計画を生成',
      '実測付きで生成',
      '結果を CSV で保存',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('選択が無ければ選択範囲のみ実行は押せない', async () => {
    // Arrange
    描く({ hasSelection: false })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))

    // Assert
    expect(screen.getByRole('button', { name: /選択範囲のみ実行/ })).toBeDisabled()
  })

  it('選択があれば選択範囲のみ実行を押せる', async () => {
    // Arrange
    const 押された = 描く({ hasSelection: true })
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /選択範囲のみ実行/ }))

    // Assert
    expect(押された).toEqual(['runSelection'])
  })

  it('実行計画の項目を押すと見積りが呼ばれメニューが閉じる', async () => {
    // Arrange
    const 押された = 描く()
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /実行計画を生成/ }))

    // Assert
    expect(押された).toEqual(['explain'])
    expect(screen.queryByRole('button', { name: /実測付きで生成/ })).not.toBeInTheDocument()
  })

  it('csv の保存を押すと保存が呼ばれる', async () => {
    // Arrange
    const 押された = 描く()
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /結果を CSV で保存/ }))

    // Assert
    expect(押された).toEqual(['saveCsv'])
  })

  it('実行中はメニューを開けない', () => {
    // Arrange
    描く({ running: true })

    // Act
    const メニュー = screen.queryByRole('button', { name: '実行のメニュー' })

    // Assert
    expect(メニュー).not.toBeInTheDocument()
  })
})
