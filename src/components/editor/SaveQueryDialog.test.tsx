import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveQueryDialog } from './SaveQueryDialog'

describe('SaveQueryDialog', () => {
  it('タブの名前が初期値として入る', () => {
    // Arrange
    render(
      <SaveQueryDialog
        defaultName="無題-1"
        sql="select * from users"
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )

    // Act
    const 名前 = screen.getByLabelText('名前')

    // Assert
    expect(名前).toHaveValue('無題-1')
  })

  it('保存する sql を見せる', () => {
    // Arrange
    render(
      <SaveQueryDialog
        defaultName="無題-1"
        sql="select * from users"
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )

    // Act
    const 本文 = screen.getByText('select * from users')

    // Assert
    expect(本文).toBeInTheDocument()
  })

  it('⏎ で名前を前後の空白を落として渡す', async () => {
    // Arrange
    const 渡された: string[] = []
    render(
      <SaveQueryDialog
        defaultName=""
        sql="select 1 from dual"
        onSubmit={(name) => 渡された.push(name)}
        onClose={() => {}}
      />,
    )

    // Act
    await userEvent.type(screen.getByLabelText('名前'), '  今日の売上  {Enter}')

    // Assert
    expect(渡された).toEqual(['今日の売上'])
  })

  it('名前が空のままでは保存できない', async () => {
    // Arrange
    const 渡された: string[] = []
    render(
      <SaveQueryDialog
        defaultName="  "
        sql="select 1 from dual"
        onSubmit={(name) => 渡された.push(name)}
        onClose={() => {}}
      />,
    )

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    // Assert
    expect(渡された).toEqual([])
  })

  it('esc で保存をやめる', async () => {
    // Arrange
    let 閉じた = false
    render(
      <SaveQueryDialog
        defaultName="無題-1"
        sql="select 1 from dual"
        onSubmit={() => {}}
        onClose={() => {
          閉じた = true
        }}
      />,
    )

    // Act
    await userEvent.type(screen.getByLabelText('名前'), '{Escape}')

    // Assert
    expect(閉じた).toBe(true)
  })
})
