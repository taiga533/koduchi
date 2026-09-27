import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetUpdaterApi, setUpdaterApi } from '../api/updater'
import { useExecutionStore } from '../stores/execution'
import { useUpdateStore } from '../stores/update'
import { 接続済みにする } from '../test/activeConnection'
import type { FakeUpdaterApi } from '../test/fakeUpdaterApi'
import { createFakeUpdaterApi } from '../test/fakeUpdaterApi'
import { resetPendingDialogs, setPendingDialogs } from '../transaction/pendingChanges'
import { checkForUpdateOnLaunch, confirmWindowClose, shouldCheckOnLaunch } from './update'

let fake: FakeUpdaterApi

/** 未コミットの確認で「やめる」を選ぶ。 */
function 閉じるのを断る(): void {
  setPendingDialogs(() => ({
    confirmProceed: async () => false,
    confirmCommit: async () => false,
  }))
}

beforeEach(() => {
  fake = createFakeUpdaterApi()
  setUpdaterApi(fake.api)
  useExecutionStore.getState().clear()
  useUpdateStore.setState({
    status: 'idle',
    dialogOpen: false,
    update: null,
    progress: null,
    error: null,
  })
  接続済みにする()
})

afterEach(() => {
  resetUpdaterApi()
  resetPendingDialogs()
})

describe('shouldCheckOnLaunch', () => {
  it('最初のウィンドウでは起動時に確かめる', () => {
    // Arrange
    const label = 'main'

    // Act
    const result = shouldCheckOnLaunch(label, false)

    // Assert
    expect(result).toBe(true)
  })

  it('接続ごとに開いたウィンドウでは確かめない', () => {
    // Arrange
    const label = 'connection-2'

    // Act
    const result = shouldCheckOnLaunch(label, false)

    // Assert
    expect(result).toBe(false)
  })

  it('開発中は確かめない', () => {
    // Arrange
    const isDev = true

    // Act
    const result = shouldCheckOnLaunch('main', isDev)

    // Assert
    expect(result).toBe(false)
  })
})

describe('checkForUpdateOnLaunch', () => {
  it('最初のウィンドウではダイアログを出さずに問い合わせる', () => {
    // Arrange
    const label = 'main'

    // Act
    checkForUpdateOnLaunch(label, false)

    // Assert
    expect(fake.calls).toEqual(['check'])
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', dialogOpen: false })
  })

  it('他のウィンドウでは問い合わせない', () => {
    // Arrange
    const label = 'connection-2'

    // Act
    checkForUpdateOnLaunch(label, false)

    // Assert
    expect(fake.calls).toEqual([])
  })
})

describe('confirmWindowClose', () => {
  it('未コミットの変更が無ければ閉じてよく再起動の予約も取り消さない', async () => {
    // Arrange
    useUpdateStore.setState({ status: 'restarting', dialogOpen: true })

    // Act
    const proceed = await confirmWindowClose()

    // Assert
    expect(proceed).toBe(true)
    expect(fake.calls).toEqual([])
    expect(useUpdateStore.getState().status).toBe('restarting')
  })

  it('関所で断られたら再起動の予約を取り消し入れ替え済みへ戻す', async () => {
    // Arrange
    useExecutionStore.setState({ inTransaction: true })
    閉じるのを断る()
    useUpdateStore.setState({ status: 'restarting', dialogOpen: true })

    // Act
    const proceed = await confirmWindowClose()

    // Assert
    expect(proceed).toBe(false)
    expect(fake.calls).toEqual(['cancelRestart'])
    expect(useUpdateStore.getState().status).toBe('installed')
  })

  it('再起動を押していないウィンドウで断られても予約を取り消す', async () => {
    // Arrange
    // 再起動は別のウィンドウで押された。このウィンドウのストアは何も知らない。
    useExecutionStore.setState({ inTransaction: true })
    閉じるのを断る()

    // Act
    const proceed = await confirmWindowClose()

    // Assert
    expect(proceed).toBe(false)
    expect(fake.calls).toEqual(['cancelRestart'])
    expect(useUpdateStore.getState().status).toBe('idle')
  })
})
