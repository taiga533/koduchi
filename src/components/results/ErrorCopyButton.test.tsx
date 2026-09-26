import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ErrorCopyButton } from './ErrorCopyButton'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { createFakeClipboard, type FakeClipboard } from '../../test/fakeClipboardApi'

/** 番号と案内の 2 行を持つ、Oracle が返す形のエラー。 */
const エラー =
  'ORA-00942: 表またはビューが存在しません\nHelp: https://docs.oracle.com/error-help/db/ora-00942/'

describe('ErrorCopyButton', () => {
  let クリップボード: FakeClipboard

  beforeEach(() => {
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
    vi.useRealTimers()
  })

  it('押すとエラーの文言が手を加えずにそのまま載る', async () => {
    // Arrange
    render(<ErrorCopyButton text={エラー} />)

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Assert
    expect(クリップボード.written).toEqual([エラー])
  })

  it('書き込めたら「コピーしました」と出る', async () => {
    // Arrange
    render(<ErrorCopyButton text={エラー} />)

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('コピーしました')
  })

  it('「コピーしました」はしばらくすると消える', async () => {
    // Arrange
    vi.useFakeTimers()
    render(<ErrorCopyButton text={エラー} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Act
    act(() => {
      vi.advanceTimersByTime(2500)
    })

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('書き込みに失敗したら「コピーしました」と出さない', async () => {
    // Arrange
    const 失敗 = new Error('クリップボードに書けません')
    const 捨てられた: unknown[] = []
    const 拾う = (reason: unknown) => 捨てられた.push(reason)
    process.on('unhandledRejection', 拾う)
    setClipboardApi({ writeText: () => Promise.reject(失敗) })
    render(<ErrorCopyButton text={エラー} />)

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    process.off('unhandledRejection', 拾う)

    // Assert: 失敗は握り潰されず大域まで届く
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(捨てられた).toEqual([失敗])
  })
})
