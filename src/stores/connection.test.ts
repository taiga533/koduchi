import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { canReachDatabase, isManualCommit, useConnectionStore } from './connection'
import type { ConnectionParams } from '../types/db'

const params: ConnectionParams = {
  username: 'koduchi',
  password: 'koduchi_dev',
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
  readOnly: false,
  autoCommit: false,
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

  it('色とグループを渡さずに繋ぐと色なしのグループ未指定になる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useConnectionStore.getState().connect('dev', params)

    // Assert
    const state = useConnectionStore.getState()
    expect(state.connection?.color).toBe('none')
    expect(state.connection?.group).toBeNull()
  })

  it('渡した色とグループは接続の状態に残る', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useConnectionStore.getState().connect('prod', params, { color: 'red', group: '本番' })

    // Assert
    const state = useConnectionStore.getState()
    expect(state.connection?.color).toBe('red')
    expect(state.connection?.group).toBe('本番')
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

describe('isManualCommit', () => {
  /** 接続中の状態を組み立てる。 */
  const 接続 = (readOnly: boolean, autoCommit: boolean) => ({
    id: 'c1',
    savedId: null,
    name: '開発',
    params: { ...params, readOnly, autoCommit },
    completion: { identifierCase: 'preserve' as const },
    color: 'none' as const,
    group: null,
  })

  it('読み取り専用でも自動コミットでもない接続は手動コミットである', () => {
    // Arrange
    const connection = 接続(false, false)

    // Act
    const 手動 = isManualCommit(connection)

    // Assert
    expect(手動).toBe(true)
  })

  it('読み取り専用の接続は手動コミットではない', () => {
    // Arrange
    const connection = 接続(true, false)

    // Act
    const 手動 = isManualCommit(connection)

    // Assert
    expect(手動).toBe(false)
  })

  it('自動コミットの接続は手動コミットではない', () => {
    // Arrange
    const connection = 接続(false, true)

    // Act
    const 手動 = isManualCommit(connection)

    // Assert
    expect(手動).toBe(false)
  })

  it('未接続は手動コミットではない', () => {
    // Arrange
    const connection = null

    // Act
    const 手動 = isManualCommit(connection)

    // Assert
    expect(手動).toBe(false)
  })
})

describe('canReachDatabase', () => {
  it('接続中だけがデータベースへ往復できる', () => {
    // Arrange & Act & Assert
    expect(canReachDatabase('connected')).toBe(true)
  })

  it('接続が切れている間は往復できない', () => {
    // Arrange: 押しても届かないボタンを出さないための判定（ADR 0026）
    // Act & Assert
    expect(canReachDatabase('lost')).toBe(false)
    expect(canReachDatabase('disconnected')).toBe(false)
    expect(canReachDatabase('connecting')).toBe(false)
    expect(canReachDatabase('failed')).toBe(false)
  })
})

describe('接続断からの回復（ADR 0026）', () => {
  it('接続断を記録すると切れた状態になり接続の情報は残る', async () => {
    // Arrange: 繋ぎ直すのに接続先とユーザーが要る
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)

    // Act
    useConnectionStore.getState().markLost('ORA-02396: 最大アイドル時間を超過しました')

    // Assert
    const state = useConnectionStore.getState()
    expect(state.status).toBe('lost')
    expect(state.connection?.name).toBe('dev')
    expect(state.error).toBe('ORA-02396: 最大アイドル時間を超過しました')
  })

  it('初めての接続断だけが段階を動かしたと答える', async () => {
    // Arrange: 印が立った後のプールは往復せずその場で断を返すため、
    // 切れたあとに触るたび同じ報せが届く（ADR 0026）
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)

    // Act
    const 一度目 = useConnectionStore.getState().markLost('ORA-02396')
    const 二度目 = useConnectionStore.getState().markLost('ORA-02396')

    // Assert
    expect(一度目).toBe(true)
    expect(二度目).toBe(false)
  })

  it('繋ぎ直したあとの接続断はまた段階を動かしたと答える', async () => {
    // Arrange: 2 度目の断を 1 度目と同じものとして飲み込まない
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    useConnectionStore.getState().markLost('ORA-02396')
    await useConnectionStore.getState().reconnect()

    // Act
    const 二度目の断 = useConnectionStore.getState().markLost('ORA-03113')

    // Assert
    expect(二度目の断).toBe(true)
  })

  it('接続していないときの接続断は状態を動かさない', () => {
    // Arrange: 切断のあとに遅れて届いたエラーで画面を戻さない
    useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })

    // Act
    const 動いた = useConnectionStore.getState().markLost('ORA-03113')

    // Assert
    expect(動いた).toBe(false)
    expect(useConnectionStore.getState().status).toBe('disconnected')
  })

  it('繋ぎ直すと接続中に戻り識別子が採番し直される', async () => {
    // Arrange: Rust 側のプールは切れた印を持ったままであり使い回せない
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params, { color: 'red', group: '本番' })
    const 前の識別子 = useConnectionStore.getState().connection?.id
    useConnectionStore.getState().markLost('ORA-02396')

    // Act
    await useConnectionStore.getState().reconnect()

    // Assert
    const state = useConnectionStore.getState()
    expect(state.status).toBe('connected')
    expect(state.connection?.id).not.toBe(前の識別子)
    expect(calls.connect).toHaveLength(2)
    expect(state.error).toBeNull()
  })

  it('繋ぎ直しても表示名と色とグループは引き継がれる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore
      .getState()
      .connect('prod', params, { savedId: 's1', color: 'red', group: '本番' })
    useConnectionStore.getState().markLost('ORA-03113')

    // Act
    await useConnectionStore.getState().reconnect()

    // Assert
    const connection = useConnectionStore.getState().connection
    expect(connection?.name).toBe('prod')
    expect(connection?.savedId).toBe('s1')
    expect(connection?.color).toBe('red')
    expect(connection?.group).toBe('本番')
  })

  it('繋ぎ直しに失敗しても切れた状態のまま接続の情報を残す', async () => {
    // Arrange: データベースが起き上がるまで、押すたびに接続を選び直させない
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    useConnectionStore.getState().markLost('ORA-02396')
    setDbApi(createFakeDbApi({ connectError: { kind: 'connect', message: 'ORA-12541' } }).api)

    // Act
    await useConnectionStore.getState().reconnect()

    // Assert
    const state = useConnectionStore.getState()
    expect(state.status).toBe('lost')
    expect(state.connection?.name).toBe('dev')
    expect(state.error).toBe('ORA-12541')
  })

  it('繋ぎ直しは古い接続の後片付けを待たない', async () => {
    // Arrange: 切れている接続のログオフは TCP が諦めるまで返らないことがある。
    // 待つと「再接続」を押しても何十秒も画面が動かない（ADR 0030）
    const { api } = createFakeDbApi()
    const 手放した: string[] = []
    setDbApi({
      ...api,
      disconnect: (id) => {
        手放した.push(id)
        return new Promise<void>(() => {})
      },
    })
    await useConnectionStore.getState().connect('dev', params)
    const 前の識別子 = useConnectionStore.getState().connection?.id
    useConnectionStore.getState().markLost('ORA-03113')

    // Act
    await useConnectionStore.getState().reconnect()

    // Assert
    expect(useConnectionStore.getState().status).toBe('connected')
    expect(useConnectionStore.getState().connection?.id).not.toBe(前の識別子)
    expect(手放した).toEqual([前の識別子])
  })

  it('繋ぎ直しを頼んだ時点で段階が接続中になる', async () => {
    // Arrange: 待ってから動かすと、その間ボタンが押せるまま残る（ADR 0030）
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    useConnectionStore.getState().markLost('ORA-02396')

    // Act
    const 繋ぎ直し = useConnectionStore.getState().reconnect()

    // Assert
    expect(useConnectionStore.getState().status).toBe('connecting')
    await 繋ぎ直し
  })

  it('繋ぎに行っている最中にもう一度頼んでも接続は増えない', async () => {
    // Arrange: 押した回数だけプールが増えると、Rust 側に迷子のプールが残る
    // （ADR 0030）
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    await useConnectionStore.getState().connect('dev', params)
    useConnectionStore.getState().markLost('ORA-02396')

    // Act
    const 一度目 = useConnectionStore.getState().reconnect()
    const 二度目 = useConnectionStore.getState().reconnect()
    await Promise.all([一度目, 二度目])

    // Assert: 最初の接続と繋ぎ直しの 1 回だけ
    expect(calls.connect).toHaveLength(2)
    expect(useConnectionStore.getState().status).toBe('connected')
  })

  it('切断は後片付けを待たずに未接続へ戻す', async () => {
    // Arrange: 切れている相手の後片付けを待つと、接続を選ぶ画面へ戻れなくなる
    // （ADR 0030）
    const { api } = createFakeDbApi()
    setDbApi({ ...api, disconnect: () => new Promise<void>(() => {}) })
    await useConnectionStore.getState().connect('dev', params)

    // Act
    await useConnectionStore.getState().disconnect()

    // Assert
    expect(useConnectionStore.getState().status).toBe('disconnected')
    expect(useConnectionStore.getState().connection).toBeNull()
  })

  it('接続の切り替えも古い接続の後片付けを待たない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi({ ...api, disconnect: () => new Promise<void>(() => {}) })
    await useConnectionStore.getState().connect('dev', params)

    // Act
    await useConnectionStore.getState().connect('prod', params)

    // Assert
    expect(useConnectionStore.getState().status).toBe('connected')
    expect(useConnectionStore.getState().connection?.name).toBe('prod')
    expect(calls.connect).toHaveLength(2)
  })

  it('接続していないときに繋ぎ直しても何も起きない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })

    // Act
    await useConnectionStore.getState().reconnect()

    // Assert
    expect(calls.connect).toHaveLength(0)
  })
})
