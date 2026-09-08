import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
    描く({ names: ['id'], values: { id: { text: '42', kind: 'varchar2', isNull: false } } })

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
    expect(変更[0].id).toEqual({ text: '7', kind: 'number', isNull: false })
  })

  it('null にチェックを付けると変更が伝わる', async () => {
    // Arrange
    const 変更: Record<string, BindInput>[] = []
    描く({ names: ['memo'], onChange: (values) => 変更.push(values) })

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: 'NULL' }))

    // Assert
    expect(変更[0].memo).toEqual({ text: '', kind: 'varchar2', isNull: true })
  })

  it('null のときは値の欄を触れなくする', () => {
    // Arrange
    描く({ names: ['memo'], values: { memo: { text: '前の値', kind: 'varchar2', isNull: true } } })

    // Act
    const 入力 = screen.getByLabelText(':memo')

    // Assert
    expect(入力).toBeDisabled()
  })

  it('前回選んだ型を初期値として出す', () => {
    // Arrange
    描く({ names: ['day'], values: { day: { text: '', kind: 'date', isNull: false } } })

    // Act
    const 型 = screen.getByLabelText(':day の型') as HTMLSelectElement

    // Assert
    expect(型.value).toBe('date')
  })

  it('型を選び直すと変更が伝わる', async () => {
    // Arrange
    const 変更: Record<string, BindInput>[] = []
    描く({ names: ['id'], onChange: (values) => 変更.push(values) })

    // Act
    await userEvent.selectOptions(screen.getByLabelText(':id の型'), 'number')

    // Assert
    expect(変更[0].id).toEqual({ text: '', kind: 'number', isNull: false })
  })

  it('日付らしい値を入力すると型も日付になる', async () => {
    // Arrange
    const 変更: Record<string, BindInput>[] = []
    描く({
      names: ['day'],
      values: { day: { text: '2024-01-', kind: 'varchar2', isNull: false } },
      onChange: (values) => 変更.push(values),
    })

    // Act
    fireEvent.change(screen.getByLabelText(':day'), { target: { value: '2024-01-02' } })

    // Assert
    expect(変更[0].day).toEqual({ text: '2024-01-02', kind: 'date', isNull: false })
  })

  it('値の見た目と違う型が選ばれていれば打ち直しても型は変わらない', () => {
    // Arrange: 空の値に DATE が選ばれている状態は、利用者か推し量りが選んだ型である
    const 変更: Record<string, BindInput>[] = []
    描く({
      names: ['code'],
      values: { code: { text: '', kind: 'date', isNull: false } },
      onChange: (values) => 変更.push(values),
    })

    // Act
    fireEvent.change(screen.getByLabelText(':code'), { target: { value: '7' } })

    // Assert
    expect(変更[0].code).toEqual({ text: '7', kind: 'date', isNull: false })
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
