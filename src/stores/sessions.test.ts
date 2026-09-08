/**
 * セッションとロックのストアのテスト（ADR 0017）。
 *
 * データベースからは `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, sessionRow, type FakeCalls } from '../test/fakeDbApi'
import type { SessionOverview } from '../types/db'
import { countBlockedSessions, filterSessions, useSessionsStore } from './sessions'

/** 待たせ手と待ち手が 1 組ずつ居る一覧。 */
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

beforeEach(() => {
  const fake = createFakeDbApi({ sessions: 一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useSessionsStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('useSessionsStore', () => {
  it('一覧を読むとセッションと連鎖が入る', async () => {
    // Arrange
    // beforeEach で窓口を差し替えてある

    // Act
    await useSessionsStore.getState().load('c1')

    // Assert
    const state = useSessionsStore.getState()
    expect(state.status).toBe('ready')
    expect(state.overview?.sessions).toHaveLength(3)
    expect(state.overview?.chains[0].sid).toBe(20)
    expect(calls.listSessions).toEqual(['c1'])
  })

  it('権限が無くて読めなかったことは空の一覧と区別される', async () => {
    // Arrange: 「見えない」と「居ない」を同じ画面で表さない（ADR 0017）
    const fake = createFakeDbApi({
      sessionsError: { kind: 'permission', message: 'V$SESSION を参照できません' },
    })
    setDbApi(fake.api)

    // Act
    await useSessionsStore.getState().load('c1')

    // Assert
    const state = useSessionsStore.getState()
    expect(state.status).toBe('failed')
    expect(state.permissionDenied).toBe(true)
    expect(state.overview).toBeNull()
  })

  it('権限以外の失敗では権限不足として扱わない', async () => {
    // Arrange
    const fake = createFakeDbApi({
      sessionsError: { kind: 'execute', message: 'ORA-03113' },
    })
    setDbApi(fake.api)

    // Act
    await useSessionsStore.getState().load('c1')

    // Assert
    const state = useSessionsStore.getState()
    expect(state.permissionDenied).toBe(false)
    expect(state.error).toBe('ORA-03113')
  })

  it('killは確認を経てから発行され一覧を読み直す', async () => {
    // Arrange
    await useSessionsStore.getState().load('c1')
    const 対象 = useSessionsStore.getState().overview!.sessions[1]

    // Act
    useSessionsStore.getState().requestKill(対象)
    await useSessionsStore.getState().confirmKill('c1')

    // Assert
    expect(calls.killSession).toEqual([{ id: 'c1', sid: 20, serial: 200 }])
    expect(calls.listSessions).toHaveLength(2)
    expect(useSessionsStore.getState().killTarget).toBeNull()
  })

  it('確認を取り消すとkillは発行されない', async () => {
    // Arrange
    await useSessionsStore.getState().load('c1')
    const 対象 = useSessionsStore.getState().overview!.sessions[1]
    useSessionsStore.getState().requestKill(対象)

    // Act
    useSessionsStore.getState().cancelKill()
    await useSessionsStore.getState().confirmKill('c1')

    // Assert
    expect(calls.killSession).toEqual([])
  })

  it('killが弾かれた理由は利用者に見せる', async () => {
    // Arrange: Rust 側の関所（読み取り専用・小槌自身の接続）で止まった場合
    const fake = createFakeDbApi({
      sessions: 一覧,
      killError: {
        kind: 'permission',
        message: '読み取り専用の接続ではセッションを終了できません',
      },
    })
    setDbApi(fake.api)
    await useSessionsStore.getState().load('c1')
    useSessionsStore.getState().requestKill(useSessionsStore.getState().overview!.sessions[1])

    // Act
    await useSessionsStore.getState().confirmKill('c1')

    // Assert
    expect(useSessionsStore.getState().killError).toContain('読み取り専用')
  })

  it('切断で捨てると絞り込みも自動更新も既定へ戻る', async () => {
    // Arrange
    await useSessionsStore.getState().load('c1')
    useSessionsStore.getState().setSearch('BATCH')
    useSessionsStore.getState().toggleAutoRefresh()

    // Act
    useSessionsStore.getState().clear()

    // Assert
    const state = useSessionsStore.getState()
    expect(state.overview).toBeNull()
    expect(state.search).toBe('')
    expect(state.autoRefresh).toBe(false)
  })
})

describe('filterSessions', () => {
  it('語が空なら並びをそのまま返す', () => {
    // Arrange
    const sessions = 一覧.sessions

    // Act
    const filtered = filterSessions(sessions, '  ')

    // Assert
    expect(filtered).toBe(sessions)
  })

  it('ユーザー名で絞り込める', () => {
    // Arrange
    const sessions = 一覧.sessions

    // Act
    const filtered = filterSessions(sessions, 'batch')

    // Assert
    expect(filtered.map((session) => session.sid)).toEqual([20])
  })

  it('sidの数字でも絞り込める', () => {
    // Arrange
    const sessions = 一覧.sessions

    // Act
    const filtered = filterSessions(sessions, '30')

    // Assert
    expect(filtered.map((session) => session.sid)).toEqual([30])
  })

  it('待機イベントでも絞り込める', () => {
    // Arrange
    const sessions = 一覧.sessions

    // Act
    const filtered = filterSessions(sessions, 'row lock')

    // Assert
    expect(filtered.map((session) => session.sid)).toEqual([30])
  })
})

describe('countBlockedSessions', () => {
  it('連鎖の根を除いた数を数える', () => {
    // Arrange
    const overview: SessionOverview = {
      ...一覧,
      chains: [{ sid: 20, blocked: [{ sid: 30, blocked: [{ sid: 40, blocked: [] }] }] }],
    }

    // Act
    const blocked = countBlockedSessions(overview)

    // Assert
    expect(blocked).toBe(2)
  })

  it('未取得なら零を返す', () => {
    // Arrange & Act
    const blocked = countBlockedSessions(null)

    // Assert
    expect(blocked).toBe(0)
  })
})
