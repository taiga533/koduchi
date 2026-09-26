import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, emptyResponse } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import { useConnectionStore } from '../stores/connection'
import { useDefinitionStore } from '../stores/definition'
import { emptyExecution, useExecutionStore } from '../stores/execution'
import { useSchemaStore } from '../stores/schema'
import { useUiStore } from '../stores/ui'
import { resetPendingDialogs, setPendingDialogs } from '../transaction/pendingChanges'
import type { Ask, AskRequest } from './ask'
import {
  cancelAllRunning,
  disconnectAndReset,
  openNewConnectionWindow,
  reconnectConnection,
  relayConnectionLost,
} from './connection'

/** 差し替えた未コミットの確認へ渡された問いかけ。 */
let 確認した問い: string[] = []

/** 未コミットの確認に返す答え。先頭から順に使う。 */
let 確認の答え: boolean[] = []

beforeEach(() => {
  確認した問い = []
  確認の答え = []
  setPendingDialogs((wording) => ({
    confirmProceed: async () => {
      確認した問い.push(wording.question)
      return 確認の答え.shift() ?? false
    },
    confirmCommit: async () => 確認の答え.shift() ?? false,
  }))
  useExecutionStore.getState().clear()
  useSchemaStore.getState().clear()
  useDefinitionStore.getState().clear()
  useUiStore.setState({ sessionsOpen: false, sourceSearchOpen: false })
  SQLタブを一枚にする()
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
  resetPendingDialogs()
})

/**
 * 決めた答えを返す尋ね方を作る。尋ねられた事柄は `尋ねた` に積む。
 *
 * @param 答え 切断できない旨の知らせへの答え
 */
function 尋ね方(答え: 'cancelExecution' | 'dismiss' = 'dismiss'): {
  ask: Ask
  尋ねた: AskRequest[]
} {
  const 尋ねた: AskRequest[] = []
  const ask = (async (request: AskRequest) => {
    尋ねた.push(request)
    return 答え
  }) as Ask
  return { ask, 尋ねた }
}

/**
 * タブを実行中にする。
 *
 * @param tabIds 実行中にするタブ
 */
function 実行中にする(...tabIds: string[]): void {
  useExecutionStore.setState({
    byTab: Object.fromEntries(tabIds.map((id) => [id, { ...emptyExecution, status: 'running' }])),
  })
}

describe('relayConnectionLost', () => {
  it('初めて切れたときだけメッセージタブへ 1 行を残す', () => {
    // Arrange
    setDbApi(createFakeDbApi().api)

    // Act: 印が立った後に同じ報せが何度も届く（ADR 0026）
    relayConnectionLost('ORA-02396')
    relayConnectionLost('ORA-02396')

    // Assert
    expect(useConnectionStore.getState().status).toBe('lost')
    expect(useExecutionStore.getState().log.filter((entry) => entry.sql === '接続')).toHaveLength(1)
  })
})

describe('reconnectConnection', () => {
  it('繋ぎ直せたら新しい接続でスキーマを取り直す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useConnectionStore.setState({ status: 'lost' })

    // Act
    await reconnectConnection()

    // Assert
    const 新しい接続 = useConnectionStore.getState().connection?.id
    expect(useConnectionStore.getState().status).toBe('connected')
    await expect.poll(() => calls.schemaOverview.at(-1)?.id).toBe(新しい接続)
  })

  it('繋ぎ直せなかったら押した結果をメッセージタブへ残す', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      connectError: { kind: 'connect', message: 'ORA-12541: TNS:no listener' },
    })
    setDbApi(api)
    useConnectionStore.setState({ status: 'lost' })

    // Act
    await reconnectConnection()

    // Assert
    const 失敗の行 = useExecutionStore
      .getState()
      .log.filter((entry) => entry.error?.includes('繋ぎ直せませんでした'))
    expect(失敗の行).toHaveLength(1)
    expect(失敗の行[0].error).toContain('ORA-12541')
  })
})

describe('cancelAllRunning', () => {
  it('実行中のタブだけに中止を送る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({
      byTab: {
        a: { ...emptyExecution, status: 'running' },
        b: { ...emptyExecution, status: 'succeeded' },
        c: { ...emptyExecution, status: 'running' },
      },
    })

    // Act
    cancelAllRunning()

    // Assert
    await expect.poll(() => calls.cancel.map((call) => call.tabId)).toEqual(['a', 'c'])
  })
})

describe('disconnectAndReset', () => {
  it('繋がっていなければ何もしない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未接続にする()
    const { ask, 尋ねた } = 尋ね方()

    // Act
    const 切断した = await disconnectAndReset(ask)

    // Assert
    expect(切断した).toBe(false)
    expect(calls.disconnect).toEqual([])
    expect(尋ねた).toEqual([])
  })

  it('実行中の文があれば切断せず、そのことを告げる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    実行中にする('sql-1')
    const { ask, 尋ねた } = 尋ね方('dismiss')

    // Act
    const 切断した = await disconnectAndReset(ask)

    // Assert
    expect(切断した).toBe(false)
    expect(尋ねた).toEqual([{ kind: 'disconnectBlocked' }])
    expect(calls.disconnect).toEqual([])
    expect(calls.cancel).toEqual([])
    expect(useConnectionStore.getState().connection).not.toBeNull()
  })

  it('告げた知らせで中止を選ぶと実行中の文を中止し、切断はしない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    実行中にする('sql-1')
    const { ask } = 尋ね方('cancelExecution')

    // Act
    const 切断した = await disconnectAndReset(ask)

    // Assert
    expect(切断した).toBe(false)
    await expect.poll(() => calls.cancel).toEqual([{ id: 'c1', tabId: 'sql-1' }])
    expect(calls.disconnect).toEqual([])
  })

  it('未コミットの確認でやめると切断しない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({ inTransaction: true })
    確認の答え = [false]

    // Act
    const 切断した = await disconnectAndReset(尋ね方().ask)

    // Assert
    expect(切断した).toBe(false)
    expect(確認した問い).toHaveLength(1)
    expect(calls.disconnect).toEqual([])
  })

  it('開いている結果セットを手放し、接続に属するものを捨ててから切断する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', 'sql-1', 'select 1 from dual', 'dev', [])
    useSchemaStore.setState({ schemas: [{ name: 'KODUCHI', objectCount: 0, objects: [] }] })
    useUiStore.setState({ sessionsOpen: true, sourceSearchOpen: true })

    // Act
    const 切断した = await disconnectAndReset(尋ね方().ask)

    // Assert
    expect(切断した).toBe(true)
    expect(calls.releaseTab).toEqual([{ id: 'c1', tabId: 'sql-1' }])
    expect(calls.disconnect).toEqual(['c1'])
    expect(useExecutionStore.getState().byTab).toEqual({})
    expect(useSchemaStore.getState().schemas).toEqual([])
    expect(useUiStore.getState().sessionsOpen).toBe(false)
    expect(useUiStore.getState().sourceSearchOpen).toBe(false)
    expect(useConnectionStore.getState().connection).toBeNull()
  })
})

describe('openNewConnectionWindow', () => {
  it('新しいウィンドウを開く', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    openNewConnectionWindow()

    // Assert
    await expect.poll(() => calls.openConnectionWindow).toBe(1)
  })
})
