import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BindInput } from '../../stores/tab'
import { BindValuesDialog } from './BindValuesDialog'

/** 既定の props でダイアログを描く。 */
function 描く(overrides: Partial<React.ComponentProps<typeof BindValuesDialog>> = {}) {
  const props = {
    names: ['id'],
    values: {} as Record<string, BindInput>,
    onChange: () => {},
    onSubmit: () => {},
    onClose: () => {},
    ...overrides,
  }
  render(<BindValuesDialog {...props} />)
  return props
}

describe('BindValuesDialog', () => {
  it('尋ねる変数をコロン付きの名前で並べる', () => {
    // Arrange
    描く({ names: ['id', 'name'] })

    // Act
    const 一つ目 = screen.getByLabelText(':id')
    const 二つ目 = screen.getByLabelText(':name')

    // Assert
    expect(一つ目).toBeInTheDocument()
    expect(二つ目).toBeInTheDocument()
  })

  it('前回の値を初期値として出す', () => {
    // Arrange
    描く({ names: ['id'], values: { id: { text: '42', isNull: false } } })

    // Act
    const 入力 = screen.getByLabelText(':id') as HTMLInputElement

    // Assert
    expect(入力.value).toBe('42')
  })

  it('値を入力すると変更が伝わる', async () => {
    // Arrange
    const 変更: Record<string, BindInput>[] = []
    描く({ names: ['id'], onChange: (values) => 変更.push(values) })

    // Act
    await userEvent.type(screen.getByLabelText(':id'), '7')

    // Assert
    expect(変更[0].id).toEqual({ text: '7', isNull: false })
  })

  it('null にチェックを付けると変更が伝わる', async () => {
    // Arrange
    const 変更: Record<string, BindInput>[] = []
    描く({ names: ['memo'], onChange: (values) => 変更.push(values) })

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: 'NULL' }))

    // Assert
    expect(変更[0].memo).toEqual({ text: '', isNull: true })
  })

  it('null のときは値の欄を触れなくする', () => {
    // Arrange
    描く({ names: ['memo'], values: { memo: { text: '前の値', isNull: true } } })

    // Act
    const 入力 = screen.getByLabelText(':memo')

    // Assert
    expect(入力).toBeDisabled()
  })

  it('この値で実行を押すと実行に進む', async () => {
    // Arrange
    let 実行した = false
    描く({ onSubmit: () => (実行した = true) })

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'この値で実行' }))

    // Assert
    expect(実行した).toBe(true)
  })

  it('入力欄で改行を打つと実行に進む', async () => {
    // Arrange
    let 実行した = false
    描く({ names: ['id'], onSubmit: () => (実行した = true) })

    // Act
    await userEvent.type(screen.getByLabelText(':id'), '{Enter}')

    // Assert
    expect(実行した).toBe(true)
  })

  it('esc を押すと取り消される', async () => {
    // Arrange
    let 閉じた = false
    描く({ names: ['id'], onClose: () => (閉じた = true) })

    // Act
    await userEvent.type(screen.getByLabelText(':id'), '{Escape}')

    // Assert
    expect(閉じた).toBe(true)
  })

  it('取り消すを押すと取り消される', async () => {
    // Arrange
    let 閉じた = false
    描く({ onClose: () => (閉じた = true) })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))

    // Assert
    expect(閉じた).toBe(true)
  })
})
