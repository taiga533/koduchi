import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { useConnectionStore } from './connection'
import type { ConnectionParams } from '../types/db'

const params: ConnectionParams = {
  username: 'koduchi',
  password: 'koduchi_dev',
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
  readOnly: false,
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
})

afterEach(() => {
  resetDbApi()
})

describe('useConnectionStore', () => {
  it('接続に成功すると接続中の状態になる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useConnectionStore.getState().connect('dev', params)

    // Assert
    const state = useConnectionStore.getState()
    expect(state.status).toBe('connected')
    expect(state.connection?.name).toBe('dev')
    expect(state.error).toBeNull()
  })

  it('接続に失敗するとエラーメッセージを保持する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      connectError: { kind: 'connect', message: 'ORA-12541: TNS:no listener' },
    })
    setDbApi(api)

    // Act
    await useConnectionStore.getState().connect('dev', params)

    // Assert
    const state = useConnectionStore.getState()
    expect(state.status).toBe('failed')
    expect(state.connection).toBeNull()
    expect(state.error).toBe('ORA-12541: TNS:no listener')
  })

  it('接続済みの状態で接続し直すと前の接続を閉じる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    const firstId = useConnectionStore.getState().connection?.id

    // Act
    await useConnectionStore.getState().connect('prod', params)

    // Assert
    expect(calls.disconnect).toEqual([firstId])
    expect(useConnectionStore.getState().connection?.name).toBe('prod')
  })

  it('切断すると未接続の状態に戻る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    const id = useConnectionStore.getState().connection?.id

    // Act
    await useConnectionStore.getState().disconnect()

    // Assert
    expect(calls.disconnect).toEqual([id])
    expect(useConnectionStore.getState().status).toBe('disconnected')
    expect(useConnectionStore.getState().connection).toBeNull()
  })

  it('未接続のまま切断しても何も呼ばれない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useConnectionStore.getState().disconnect()

    // Assert
    expect(calls.disconnect).toEqual([])
  })
})
