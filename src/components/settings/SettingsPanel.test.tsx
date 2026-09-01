import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import { defaultAppearance } from '../../theme/appearance'
import { defaultCsvOptions } from '../../types/db'
import { useUiStore } from '../../stores/ui'
import { SettingsPanel } from './SettingsPanel'

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi()
  calls = fake.calls
  setDbApi(fake.api)
  useUiStore.setState({ appearance: defaultAppearance, csvOptions: defaultCsvOptions })
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  resetDbApi()
})

describe('SettingsPanel', () => {
  it('テーマは 3 択である', () => {
    // Arrange
    render(<SettingsPanel clientUnavailable={false} onClose={() => {}} />)

    // Act
    const 選択肢 = ['システム', 'ライト', 'ダーク'].map((label) =>
      screen.getByRole('button', { name: label }),
    )

    // Assert
    expect(選択肢).toHaveLength(3)
  })

  it('テーマを選ぶとルート要素へ反映される', async () => {
    // Arrange
    render(<SettingsPanel clientUnavailable={false} onClose={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'ダーク' }))

    // Assert
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('罫線の有無を切り替えられる', async () => {
    // Arrange
    render(<SettingsPanel clientUnavailable={false} onClose={() => {}} />)

    // Act
    await userEvent.click(screen.getByLabelText('結果テーブルに罫線を引く'))

    // Assert
    expect(useUiStore.getState().appearance.gridLines).toBe(false)
  })

  it('履歴を一括削除できる', async () => {
    // Arrange
    render(<SettingsPanel clientUnavailable={false} onClose={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '履歴をすべて削除' }))

    // Assert
    expect(calls.clearHistory).toBe(1)
    expect(screen.getByText('履歴をすべて削除しました。')).toBeInTheDocument()
  })

  it('instant client が検出できているときはパスの欄を出さない', () => {
    // Arrange
    render(<SettingsPanel clientUnavailable={false} onClose={() => {}} />)

    // Act
    const 欄 = screen.queryByLabelText('Instant Client のディレクトリ')

    // Assert
    expect(欄).not.toBeInTheDocument()
  })

  it('instant client が未検出のときだけパスの欄を出す', () => {
    // Arrange
    render(<SettingsPanel clientUnavailable onClose={() => {}} />)

    // Act
    const 欄 = screen.getByLabelText('Instant Client のディレクトリ')

    // Assert
    expect(欄).toBeInTheDocument()
  })

  it('閉じる操作を呼び出し側へ伝える', async () => {
    // Arrange
    let 閉じた = false
    render(<SettingsPanel clientUnavailable={false} onClose={() => (閉じた = true)} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '設定を閉じる' }))

    // Assert
    expect(閉じた).toBe(true)
  })
})
