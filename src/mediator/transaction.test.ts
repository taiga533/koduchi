import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { 接続済みにする, 未接続にする } from '../test/activeConnection'
import { useConnectionStore } from '../stores/connection'
import { useExecutionStore } from '../stores/execution'
import {
  CLOSE_WORDING,
  resetPendingDialogs,
  setPendingDialogs,
} from '../transaction/pendingChanges'
import { commitTransaction, resolvePendingTransaction, rollbackTransaction } from './transaction'

/** 未コミットの確認に返す答え。先頭から順に使う。 */
let 確認の答え: boolean[] = []

/** 差し替えた確認へ実際に渡された問いかけ。 */
let 確認した問い: string[] = []

beforeEach(() => {
  確認の答え = []
  確認した問い = []
  setPendingDialogs((wording) => ({
    confirmProceed: async () => {
      確認した問い.push(wording.question)
      return 確認の答え.shift() ?? false
    },
    confirmCommit: async () => 確認の答え.shift() ?? false,
  }))
  useExecutionStore.getState().clear()
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
  resetPendingDialogs()
})

/** 未コミットの変更がある状態にする。 */
function 未コミットにする(): void {
  useExecutionStore.setState({ inTransaction: true })
}

describe('commitTransaction / rollbackTransaction', () => {
  it('繋がっていればその接続へコミットを送る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    commitTransaction()

    // Assert
    await expect.poll(() => calls.commit).toEqual(['c1'])
  })

  it('繋がっていればその接続へロールバックを送る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    rollbackTransaction()

    // Assert
    await expect.poll(() => calls.rollback).toEqual(['c1'])
  })

  it('繋がっていなければ何も送らない', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未接続にする()

    // Act
    commitTransaction()
    rollbackTransaction()

    // Assert
    expect(calls.commit).toEqual([])
    expect(calls.rollback).toEqual([])
  })
})

describe('resolvePendingTransaction', () => {
  it('未コミットが無ければ尋ねずに進める', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(true)
    expect(確認した問い).toEqual([])
  })

  it('自動コミットの接続では尋ねずに進める', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    接続済みにする({ autoCommit: true })
    未コミットにする()

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(true)
    expect(確認した問い).toEqual([])
  })

  it('接続が切れていれば尋ねずに進める', async () => {
    // Arrange: 届かないコミットを尋ねて袋小路へ入れない（ADR 0026）
    setDbApi(createFakeDbApi().api)
    未コミットにする()
    useConnectionStore.setState({ status: 'lost' })

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(true)
    expect(確認した問い).toEqual([])
  })

  it('やめるを選ぶと進めず、コミットもロールバックもしない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未コミットにする()
    確認の答え = [false]

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(false)
    expect(確認した問い).toEqual([CLOSE_WORDING.question])
    expect(calls.commit).toEqual([])
    expect(calls.rollback).toEqual([])
  })

  it('コミットを選ぶとコミットしてから進める', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未コミットにする()
    確認の答え = [true, true]

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(true)
    expect(calls.commit).toEqual(['c1'])
  })

  it('コミットに失敗したら進めない', async () => {
    // Arrange: 失敗を告げないまま手放すと、変更は暗黙のロールバックで消える
    const { api } = createFakeDbApi({
      commitError: { kind: 'execute', message: 'ORA-02091: transaction rolled back' },
    })
    setDbApi(api)
    未コミットにする()
    確認の答え = [true, true]

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(false)
  })

  it('破棄を選ぶとロールバックしてから進める', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未コミットにする()
    確認の答え = [true, false]

    // Act
    const 進める = await resolvePendingTransaction(CLOSE_WORDING)

    // Assert
    expect(進める).toBe(true)
    expect(calls.rollback).toEqual(['c1'])
    expect(calls.commit).toEqual([])
  })
})
