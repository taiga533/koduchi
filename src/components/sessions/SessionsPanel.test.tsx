/**
 * セッションとロックのパネルのテスト（ADR 0017）。
 *
 * 一覧の描画・ブロッキングの表示・kill の確認ダイアログ・権限不足の見せ方を見る。
 * データベースからは `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, sessionRow, type FakeCalls } from '../../test/fakeDbApi'
import { useSessionsStore } from '../../stores/sessions'
import type { SessionOverview } from '../../types/db'
import { SessionsPanel } from './SessionsPanel'

/** 20 が 30 を待たせている一覧。10 は小槌自身の接続である。 */
const 一覧: SessionOverview = {
  instance: 1,
  currentSid: 10,
  sessions: [
    sessionRow({ sid: 10, own: true, program: 'koduchi' }),
    sessionRow({ sid: 20, username: 'BATCH', program: 'sqlplus' }),
    sessionRow({
      sid: 30,
      username: 'WEB',
      status: 'ACTIVE',
      event: 'enq: TX - row lock contention',
      secondsInWait: 42,
      blockingSession: 20,
      blockingInstance: 1,
    }),
  ],
  chains: [{ sid: 20, blocked: [{ sid: 30, blocked: [] }] }],
}

let calls: FakeCalls

/**
 * パネルを描く。
 *
 * @param readOnly 読み取り専用の接続として描くか
 */
function パネルを描く(readOnly = false) {
  const onClose = vi.fn()
  render(<SessionsPanel connectionId="c1" readOnly={readOnly} onClose={onClose} />)
  return { onClose }
}

beforeEach(() => {
  const fake = createFakeDbApi({ sessions: 一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useSessionsStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('SessionsPanel', () => {
  it('開くと一覧を読み込んでセッションが並ぶ', async () => {
    // Arrange & Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('BATCH')).toBeInTheDocument()
    expect(screen.getByText('WEB')).toBeInTheDocument()
    expect(calls.listSessions).toEqual(['c1'])
  })

  it('自分自身の接続にはこの接続と印が付く', async () => {
    // Arrange & Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('この接続')).toBeInTheDocument()
  })

  it('ブロッキングの連鎖と待たされている数が出る', async () => {
    // Arrange & Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('1 セッションが待たされています')).toBeInTheDocument()
    expect(screen.getByText('SID 20（連鎖の根）')).toBeInTheDocument()
    expect(screen.getByText('↳ SID 30')).toBeInTheDocument()
  })

  it('待っているセッションにはブロック元が出る', async () => {
    // Arrange & Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('SID 20')).toBeInTheDocument()
    expect(screen.getByText('enq: TX - row lock contention')).toBeInTheDocument()
  })

  it('誰も待っていなければロック待ちが無いことを示す', async () => {
    // Arrange
    const fake = createFakeDbApi({
      sessions: { ...一覧, sessions: [sessionRow({ sid: 10, own: true })], chains: [] },
    })
    setDbApi(fake.api)

    // Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('ロック待ちのセッションはありません')).toBeInTheDocument()
  })

  it('絞り込むと当てはまる行だけが残る', async () => {
    // Arrange
    const user = userEvent.setup()
    パネルを描く()
    await screen.findByText('BATCH')

    // Act
    await user.type(screen.getByLabelText('セッションを絞り込む'), 'BATCH')

    // Assert
    expect(screen.getByText('BATCH')).toBeInTheDocument()
    expect(screen.queryByText('WEB')).not.toBeInTheDocument()
  })

  it('killは確認ダイアログを経てから発行される', async () => {
    // Arrange: 押し間違いで他人の仕事を落とさないための関所（ADR 0017）
    const user = userEvent.setup()
    パネルを描く()
    await screen.findByText('BATCH')

    // Act
    await user.click(screen.getByRole('button', { name: 'SID 20 を終了' }))

    // Assert: 確認を出しただけでは発行しない
    expect(screen.getByRole('dialog', { name: 'セッションの終了を確認' })).toBeInTheDocument()
    expect(calls.killSession).toEqual([])

    // Act: 確認して初めて発行する
    await user.click(screen.getByRole('button', { name: '終了する' }))

    // Assert
    expect(calls.killSession).toEqual([{ id: 'c1', sid: 20, serial: 200 }])
  })

  it('確認でやめるとkillは発行されない', async () => {
    // Arrange
    const user = userEvent.setup()
    パネルを描く()
    await screen.findByText('BATCH')
    await user.click(screen.getByRole('button', { name: 'SID 20 を終了' }))

    // Act
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    // Assert
    expect(calls.killSession).toEqual([])
    expect(screen.queryByRole('dialog', { name: 'セッションの終了を確認' })).not.toBeInTheDocument()
  })

  it('小槌自身の接続にはkillのボタンを出さない', async () => {
    // Arrange & Act
    パネルを描く()
    await screen.findByText('BATCH')

    // Assert
    expect(screen.queryByRole('button', { name: 'SID 10 を終了' })).not.toBeInTheDocument()
  })

  it('読み取り専用の接続ではkillのボタンを出さない', async () => {
    // Arrange & Act: 弾かれるボタンを見せない（ADR 0017・0004）
    パネルを描く(true)
    await screen.findByText('BATCH')

    // Assert
    expect(screen.queryByRole('button', { name: 'SID 20 を終了' })).not.toBeInTheDocument()
  })

  it('killが弾かれた理由をパネルに出す', async () => {
    // Arrange
    const user = userEvent.setup()
    const fake = createFakeDbApi({
      sessions: 一覧,
      killError: { kind: 'permission', message: 'この接続には ALTER SYSTEM 権限がありません' },
    })
    setDbApi(fake.api)
    パネルを描く()
    await screen.findByText('BATCH')
    await user.click(screen.getByRole('button', { name: 'SID 20 を終了' }))

    // Act
    await user.click(screen.getByRole('button', { name: '終了する' }))

    // Assert
    expect(
      await screen.findByText('この接続には ALTER SYSTEM 権限がありません'),
    ).toBeInTheDocument()
  })

  it('権限が無いときは空の一覧ではなく理由を出す', async () => {
    // Arrange: 「見えない」と「居ない」は別物である（ADR 0017）
    const fake = createFakeDbApi({
      sessionsError: {
        kind: 'permission',
        message: 'V$SESSION を参照できません。この接続には参照権限がありません',
      },
    })
    setDbApi(fake.api)

    // Act
    パネルを描く()

    // Assert
    expect(await screen.findByText('この接続では V$SESSION を参照できません')).toBeInTheDocument()
    expect(screen.queryByText('当てはまるセッションがありません')).not.toBeInTheDocument()
  })

  it('更新を押すと読み直す', async () => {
    // Arrange
    const user = userEvent.setup()
    パネルを描く()
    await screen.findByText('BATCH')

    // Act
    await user.click(screen.getByRole('button', { name: '更新' }))

    // Assert
    expect(calls.listSessions).toHaveLength(2)
  })

  it('閉じるボタンで閉じる', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onClose } = パネルを描く()
    await screen.findByText('BATCH')

    // Act
    await user.click(screen.getByRole('button', { name: 'セッションとロックを閉じる' }))

    // Assert
    expect(onClose).toHaveBeenCalled()
  })

  it('escで閉じる', async () => {
    // Arrange
    const user = userEvent.setup()
    const { onClose } = パネルを描く()
    await screen.findByText('BATCH')

    // Act
    await user.keyboard('{Escape}')

    // Assert
    expect(onClose).toHaveBeenCalled()
  })

  it('確認の最中のescは確認だけを取り消す', async () => {
    // Arrange: 押し間違いを取り消したつもりで一覧まで失わせない
    const user = userEvent.setup()
    const { onClose } = パネルを描く()
    await screen.findByText('BATCH')
    await user.click(screen.getByRole('button', { name: 'SID 20 を終了' }))

    // Act
    await user.keyboard('{Escape}')

    // Assert
    expect(screen.queryByRole('dialog', { name: 'セッションの終了を確認' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('自動更新を入れると間隔ごとに読み直し閉じると止まる', async () => {
    // Arrange: 画面を離れたらポーリングも止める（ADR 0017）
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <SessionsPanel connectionId="c1" readOnly={false} onClose={vi.fn()} />,
      )
      await vi.advanceTimersByTimeAsync(0)
      useSessionsStore.getState().toggleAutoRefresh()

      // Act
      await vi.advanceTimersByTimeAsync(10_000)
      const 閉じる前 = calls.listSessions.length
      unmount()
      await vi.advanceTimersByTimeAsync(10_000)

      // Assert
      expect(閉じる前).toBeGreaterThanOrEqual(3)
      expect(calls.listSessions).toHaveLength(閉じる前)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SessionsPanel の IME 対応（ADR 0025）', () => {
  it('変換中の esc ではパネルを閉じない', () => {
    // Arrange
    const { onClose } = パネルを描く()

    // Act
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })

    // Assert
    expect(onClose).not.toHaveBeenCalled()
  })

  it('変換していないときの esc は今までどおりパネルを閉じる', () => {
    // Arrange
    const { onClose } = パネルを描く()

    // Act
    fireEvent.keyDown(window, { key: 'Escape' })

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
