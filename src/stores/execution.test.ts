import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, emptyResponse, queryResponse, statementResponse } from '../test/fakeDbApi'
import {
  discardOpenCursors,
  emptyExecution,
  formatResultSummary,
  formatStatementOutcome,
  selectExecution,
  selectResultTabs,
  selectStatementsInFlight,
  useExecutionStore,
} from './execution'
import type { TabExecution } from './execution'
import type { Bind, Cell, Chunk, Column, ExecuteResponse } from '../types/db'

const TAB = 'tab-1'

const 列: Column[] = [
  { name: 'N', typeName: 'NUMBER(38,0)', kind: 'number' },
  { name: 'S', typeName: 'VARCHAR2(10)', kind: 'text' },
]

/** 連番の行を `件数` ぶん作る。 */
function 行を作る(件数: number, 開始 = 0): Cell[][] {
  return Array.from({ length: 件数 }, (_, index) => [
    { text: String(開始 + index), kind: 'number' as const },
    { text: 'あ', kind: 'text' as const },
  ])
}

/**
 * 応答を後から決められる実行を作る。
 *
 * 実行の最中の状態（進み具合や中止）を確かめるために使う。
 */
function 保留の応答(): {
  promise: Promise<ExecuteResponse>
  応える: (response: ExecuteResponse) => void
  呼ばれるまで待つ: () => Promise<void>
} {
  let 応える!: (response: ExecuteResponse) => void
  let 呼ばれた!: () => void
  const 呼び出し = new Promise<void>((resolve) => {
    呼ばれた = resolve
  })
  const promise = new Promise<ExecuteResponse>((resolve) => {
    応える = (response) => resolve(response)
  })

  return {
    get promise() {
      呼ばれた()
      return promise
    },
    応える,
    呼ばれるまで待つ: () => 呼び出し,
  }
}

/**
 * 解決と失敗を手で決める待ちを作る。
 *
 * 続きの取り出しや実行計画が、タブを閉じた後に遅れて返る順序を再現するために使う。
 */
function 手で返す<T>(): {
  promise: Promise<T>
  返す: (value: T) => void
  失敗させる: (error: unknown) => void
} {
  let 返す!: (value: T) => void
  let 失敗させる!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    返す = resolve
    失敗させる = reject
  })
  return { promise, 返す, 失敗させる }
}

beforeEach(() => {
  useExecutionStore.getState().clear()
  // 応答待ちの文は clear では消えない。前のテストが返さずに残した要求を持ち越さない。
  useExecutionStore.setState({ pendingRequests: [] })
})

afterEach(() => {
  resetDbApi()
})

describe('useExecutionStore', () => {
  it('実行に成功すると最初のかたまりを保持する', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('succeeded')
    expect(execution.rows).toHaveLength(2)
    expect(execution.exhausted).toBe(true)
    expect(execution.error).toBeNull()
  })

  it('実行結果はタブごとに分かれて保持される', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', 'tab-a', 'select 1 from dual', '開発', [])

    // Assert
    expect(selectExecution(useExecutionStore.getState(), 'tab-a').rows).toHaveLength(2)
    expect(selectExecution(useExecutionStore.getState(), 'tab-b')).toEqual(emptyExecution)
  })

  it('実行に成功するとログに 1 件積まれる', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    const log = useExecutionStore.getState().log
    expect(log).toHaveLength(1)
    expect(log[0].sql).toBe('select 1 from dual')
    expect(log[0].rowCount).toBe(2)
    expect(log[0].error).toBeNull()
  })

  it('実行に失敗するとエラーメッセージを保持する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => {
        throw { kind: 'execute', message: 'ORA-00942: table or view does not exist' }
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select * from nowhere', '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('failed')
    expect(execution.rows).toHaveLength(0)
    expect(execution.error).toBe('ORA-00942: table or view does not exist')
  })

  it('実行中は同じタブの次の実行を受け付けない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({ byTab: { [TAB]: { ...emptyExecution, status: 'running' } } })

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    expect(calls.execute).toEqual([])
  })

  it('巻き添えで閉じられたタブは破棄済みになる', async () => {
    // Arrange: 巻き添えになるのは結果セットを開いたままのタブである（ADR 0003）
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { discardedTab: 'tab-a' }),
    })
    setDbApi(api)
    useExecutionStore.setState({
      byTab: { 'tab-a': { ...emptyExecution, status: 'succeeded', exhausted: false } },
    })

    // Act
    await useExecutionStore.getState().execute('c1', 'tab-b', 'select 1 from dual', '開発', [])

    // Assert
    expect(selectExecution(useExecutionStore.getState(), 'tab-a').status).toBe('discarded')
    expect(selectExecution(useExecutionStore.getState(), 'tab-b').status).toBe('succeeded')
  })
})

describe('fetchMore', () => {
  it('続きを取り出すと行が後ろへ伸びる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1000), { exhausted: false }),
      onFetchMore: () => ({ rows: 行を作る(500, 1000), exhausted: true }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])

    // Act
    await useExecutionStore.getState().fetchMore('c1', TAB)

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.rows).toHaveLength(1500)
    expect(execution.exhausted).toBe(true)
    expect(execution.rows[1499][0].text).toBe('1499')
  })

  it('カーソルが尽きていれば続きを取りにいかない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Act
    await useExecutionStore.getState().fetchMore('c1', TAB)

    // Assert
    expect(calls.fetchMore).toEqual([])
  })

  it('取得中はさらに取りにいかない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1000), { exhausted: false }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])
    useExecutionStore.setState((state) => ({
      byTab: { ...state.byTab, [TAB]: { ...state.byTab[TAB], loadingMore: true } },
    }))

    // Act
    await useExecutionStore.getState().fetchMore('c1', TAB)

    // Assert
    expect(calls.fetchMore).toEqual([])
  })

  it('結果セットが閉じられていると破棄済みになる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1000), { exhausted: false }),
      onFetchMore: () => {
        throw { kind: 'closed', message: '結果は破棄されました。再実行してください' }
      },
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])

    // Act
    await useExecutionStore.getState().fetchMore('c1', TAB)

    // Assert
    expect(selectExecution(useExecutionStore.getState(), TAB).status).toBe('discarded')
  })

  it('行数の概念が無い文では影響行数を持たない', async () => {
    // Arrange: DDL は影響行数が `null` で届く（ADR 0034）
    const { api } = createFakeDbApi({ onExecute: () => statementResponse(null) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'create table t (id number)', '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('succeeded')
    expect(execution.affectedRows).toBeNull()
    expect(execution.isStatement).toBe(true)
  })

  it('行数の概念が無い文は履歴にも行数を残さない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => statementResponse(null) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'create table t (id number)', '開発', [])

    // Assert
    expect(calls.recordHistory[0].rowCount).toBeNull()
    expect(useExecutionStore.getState().log[0].rowCount).toBeNull()
  })

  it('1 行も当たらなかった dml は履歴に 0 行として残る', async () => {
    // Arrange: 空振りした DML と DDL を履歴の上でも取り違えない（ADR 0034）
    const { api, calls } = createFakeDbApi({ onExecute: () => statementResponse(0) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'delete from t', '開発', [])

    // Assert
    expect(calls.recordHistory[0].rowCount).toBe(0)
    expect(useExecutionStore.getState().log[0].rowCount).toBe(0)
  })
})

describe('executeScript（スクリプト実行）', () => {
  it('複数の文を順に実行する', async () => {
    // Arrange
    const 実行した順: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した順.push(sql)
        return emptyResponse
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore
      .getState()
      .executeScript(
        'c1',
        TAB,
        ['create table t (n number)', 'insert into t values (1)'],
        '開発',
        [],
      )

    // Assert
    expect(実行した順).toEqual(['create table t (n number)', 'insert into t values (1)'])
  })

  it('途中で失敗すると以降の文は実行しない', async () => {
    // Arrange
    const 実行した順: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した順.push(sql)
        if (sql === '文2') {
          throw { kind: 'execute', message: 'ORA-00942: table or view does not exist' }
        }
        return emptyResponse
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])

    // Assert
    expect(実行した順).toEqual(['文1', '文2'])
  })

  it('失敗した文が何文目かを保持する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        if (sql === '文2') {
          throw { kind: 'execute', message: 'ORA-00942' }
        }
        return emptyResponse
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('failed')
    expect(execution.progress).toEqual({ index: 2, total: 3 })
    expect(execution.error).toBe('ORA-00942')
  })

  it('途中で失敗しても未コミットの状態は最後の応答のまま残る', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        if (sql === '文2') {
          throw { kind: 'execute', message: 'ORA-00001' }
        }
        return { ...emptyResponse, affectedRows: 1, inTransaction: true }
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(true)
  })

  it('履歴には 1 文ずつ記録する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2'], '開発', [])

    // Assert
    expect(calls.recordHistory.map((entry) => entry.sql)).toEqual(['文1', '文2'])
  })

  it('バインド変数の値は全文で使い回す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [
      { name: 'id', kind: 'number', value: '7' },
      { name: 'name', kind: 'varchar2', value: null },
    ]

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2'], '開発', binds)

    // Assert
    expect(calls.execute.map((call) => call.binds)).toEqual([binds, binds])
  })

  it('ログには何文目かを添えて 1 文ずつ積む', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2'], '開発', [])

    // Assert
    const log = useExecutionStore.getState().log
    expect(log.map((entry) => entry.sql)).toEqual(['文1', '文2'])
    expect(log.map((entry) => entry.statement)).toEqual([
      { index: 1, total: 2 },
      { index: 2, total: 2 },
    ])
  })

  it('最後に結果セットを返した文の結果を残す', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: (sql) =>
        sql === 'select 2' ? queryResponse(列, 行を作る(2)) : { ...emptyResponse, affectedRows: 5 },
    })
    setDbApi(api)

    // Act
    await useExecutionStore
      .getState()
      .executeScript('c1', TAB, ['update t', 'select 2'], '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('succeeded')
    expect(execution.rows).toHaveLength(2)
    expect(execution.progress).toBeNull()
  })

  it('問い合わせを含まないスクリプトでは影響行数を足し上げる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => ({ ...emptyResponse, affectedRows: 3, elapsedMs: 10 }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.affectedRows).toBe(9)
    expect(execution.elapsedMs).toBe(30)
  })

  it('行数の概念が無い文だけのスクリプトでは影響行数を持たない', async () => {
    // Arrange: DDL を並べたスクリプトに「0 行」と出さない（ADR 0034）
    const { api } = createFakeDbApi({ onExecute: () => statementResponse(null) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2'], '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.affectedRows).toBeNull()
    expect(execution.isStatement).toBe(true)
    expect(formatResultSummary(execution)).toBe('完了しました · 24 ms')
  })

  it('dml と ddl が混ざったスクリプトでは dml の行数だけを足し上げる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: (sql) => (sql === 'ddl' ? statementResponse(null) : statementResponse(3)),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['ddl', 'dml', 'dml'], '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.affectedRows).toBe(6)
  })

  it('実行中は何文目かを進み具合として持つ', async () => {
    // Arrange
    const 二文目 = 保留の応答()
    const { api } = createFakeDbApi({
      onExecute: (sql) => (sql === '文2' ? 二文目.promise : emptyResponse),
    })
    setDbApi(api)

    // Act
    const 実行 = useExecutionStore
      .getState()
      .executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])
    await 二文目.呼ばれるまで待つ()

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.progress).toEqual({ index: 2, total: 3 })
    expect(formatResultSummary(execution)).toBe('2 / 3 文目を実行中')
    二文目.応える(emptyResponse)
    await 実行
  })

  it('中止すると残りの文を実行しない', async () => {
    // Arrange
    const 一文目 = 保留の応答()
    const 実行した順: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した順.push(sql)
        return sql === '文1' ? 一文目.promise : emptyResponse
      },
    })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2'], '開発', [])
    await 一文目.呼ばれるまで待つ()

    // Act
    await useExecutionStore.getState().cancel('c1', TAB)
    一文目.応える(emptyResponse)
    await 実行

    // Assert
    expect(実行した順).toEqual(['文1'])
    expect(selectExecution(useExecutionStore.getState(), TAB).error).toBe('実行を中止しました')
  })

  it('文が 1 つも無ければ何もしない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, [], '開発', [])

    // Assert
    expect(calls.execute).toEqual([])
    expect(selectExecution(useExecutionStore.getState(), TAB)).toEqual(emptyExecution)
  })
})

describe('cancel と releaseTab', () => {
  it('実行中でなければ中止を送らない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().cancel('c1', TAB)

    // Assert
    expect(calls.cancel).toEqual([])
  })

  it('実行中なら中止を送る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({ byTab: { [TAB]: { ...emptyExecution, status: 'running' } } })

    // Act
    await useExecutionStore.getState().cancel('c1', TAB)

    // Assert
    expect(calls.cancel).toEqual([{ id: 'c1', tabId: TAB }])
  })

  it('タブを手放すと結果セットが閉じられ状態も消える', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)

    // Assert
    expect(calls.releaseTab).toEqual([{ id: 'c1', tabId: TAB }])
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })
})

describe('selectStatementsInFlight', () => {
  it('実行中のタブを閉じても応答が返るまでは走っている文として数える', async () => {
    // Arrange: 閉じたタブの項目は先に消えるが、文はまだデータベースで走っている
    const 応答 = 保留の応答()
    const { api } = createFakeDbApi({ onExecute: () => 応答.promise })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'update t set a = 1', '開発', [])
    await 応答.呼ばれるまで待つ()

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)

    // Assert
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
    expect(selectStatementsInFlight(useExecutionStore.getState())).toBe(true)
    応答.応える(emptyResponse)
    await 実行
  })

  it('応答が返れば走っている文として数えない', async () => {
    // Arrange
    const 応答 = 保留の応答()
    const { api } = createFakeDbApi({ onExecute: () => 応答.promise })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'update t set a = 1', '開発', [])
    await 応答.呼ばれるまで待つ()
    await useExecutionStore.getState().releaseTab('c1', TAB)

    // Act
    応答.応える(emptyResponse)
    await 実行

    // Assert
    expect(selectStatementsInFlight(useExecutionStore.getState())).toBe(false)
  })

  it('失敗が返っても走っている文として数えない', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => Promise.reject({ kind: 'execute', message: 'ORA-00942' }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select * from nowhere', '開発', [])

    // Assert
    expect(selectStatementsInFlight(useExecutionStore.getState())).toBe(false)
  })

  it('結果を捨てても応答待ちの文は数え続ける', async () => {
    // Arrange: 接続を捨てても文はデータベースで走り続けている
    const 応答 = 保留の応答()
    const { api } = createFakeDbApi({ onExecute: () => 応答.promise })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'update t set a = 1', '開発', [])
    await 応答.呼ばれるまで待つ()

    // Act
    useExecutionStore.getState().clear()

    // Assert
    expect(selectStatementsInFlight(useExecutionStore.getState())).toBe(true)
    応答.応える(emptyResponse)
    await 実行
  })

  it('スクリプト実行の文と文の間も実行中のタブとして数える', () => {
    // Arrange: 文と文の間には応答待ちの要求が無い
    useExecutionStore.setState({
      byTab: { [TAB]: { ...emptyExecution, status: 'running' } },
      pendingRequests: [],
    })

    // Act
    const 走っている = selectStatementsInFlight(useExecutionStore.getState())

    // Assert
    expect(走っている).toBe(true)
  })

  it('何も走っていなければ偽を返す', () => {
    // Arrange
    useExecutionStore.setState({
      byTab: { [TAB]: { ...emptyExecution, status: 'succeeded' } },
      pendingRequests: [],
    })

    // Act
    const 走っている = selectStatementsInFlight(useExecutionStore.getState())

    // Assert
    expect(走っている).toBe(false)
  })
})

describe('閉じたタブへの遅れた応答', () => {
  it('閉じた実行中のタブの応答が切断の後に返っても未コミットの表示とログを書き戻さない', async () => {
    // Arrange: 閉じたタブの項目は先に消えるため、実行中の文があっても切断の関所を通れる
    const 応答 = 保留の応答()
    const { api, calls } = createFakeDbApi({ onExecute: () => 応答.promise })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'update t set a = 1', '開発', [])
    await 応答.呼ばれるまで待つ()
    await useExecutionStore.getState().releaseTab('c1', TAB)
    useExecutionStore.getState().clear()

    // Act
    応答.応える(statementResponse(1, { inTransaction: true }))
    await 実行

    // Assert: 文が走った事実は履歴に残す
    const state = useExecutionStore.getState()
    expect(state.inTransaction).toBe(false)
    expect(state.log).toEqual([])
    expect(state.byTab).toEqual({})
    expect(calls.recordHistory.map((entry) => entry.sql)).toEqual(['update t set a = 1'])
  })

  it('閉じた実行中のタブの失敗が切断の後に返ってもログを書き戻さない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    let 失敗させる!: (error: unknown) => void
    let 呼ばれた!: () => void
    const 呼び出し = new Promise<void>((resolve) => {
      呼ばれた = resolve
    })
    setDbApi({
      ...api,
      execute: () =>
        new Promise<ExecuteResponse>((_, reject) => {
          失敗させる = reject
          呼ばれた()
        }),
    })
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])
    await 呼び出し
    await useExecutionStore.getState().releaseTab('c1', TAB)
    useExecutionStore.getState().clear()

    // Act
    失敗させる({ kind: 'execute', message: 'ORA-01013' })
    await 実行

    // Assert
    expect(useExecutionStore.getState().log).toEqual([])
    expect(calls.recordHistory).toHaveLength(1)
  })

  it('手放した後に同じタブで実行し直すと古い実行の応答は新しい実行を上書きしない', async () => {
    // Arrange: 項目の有無ではなく世代で見ていることを確かめる。新しい実行が
    // 項目を作り直しているため、有無だけでは古い応答を通してしまう
    const 古い = 保留の応答()
    const 新しい = 保留の応答()
    const 応答 = [古い, 新しい]
    const { api } = createFakeDbApi({ onExecute: () => 応答.shift()!.promise })
    setDbApi(api)
    const 古い実行 = useExecutionStore.getState().execute('c1', TAB, '古い文', '開発', [])
    await 古い.呼ばれるまで待つ()
    await useExecutionStore.getState().releaseTab('c1', TAB)
    const 新しい実行 = useExecutionStore.getState().execute('c1', TAB, '新しい文', '開発', [])
    await 新しい.呼ばれるまで待つ()

    // Act
    古い.応える(queryResponse(列, 行を作る(5)))
    await 古い実行

    // Assert
    expect(selectExecution(useExecutionStore.getState(), TAB).status).toBe('running')
    新しい.応える(queryResponse(列, 行を作る(1)))
    await 新しい実行
    expect(selectExecution(useExecutionStore.getState(), TAB).rows).toHaveLength(1)
  })

  it('手放した後に同じタブで実行し直すと古いスクリプトは残りの文を投げない', async () => {
    // Arrange: 項目の有無ではなく世代で見ていることを確かめる
    const 一文目 = 保留の応答()
    const 再実行 = 保留の応答()
    const 実行した: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した.push(sql)
        if (sql === '文1') return 一文目.promise
        if (sql === '再実行') return 再実行.promise
        return emptyResponse
      },
    })
    setDbApi(api)
    const スクリプト = useExecutionStore
      .getState()
      .executeScript('c1', TAB, ['文1', '文2'], '開発', [])
    await 一文目.呼ばれるまで待つ()
    await useExecutionStore.getState().releaseTab('c1', TAB)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, '再実行', '開発', [])
    await 再実行.呼ばれるまで待つ()

    // Act
    一文目.応える(emptyResponse)
    await スクリプト

    // Assert
    expect(実行した).toEqual(['文1', '再実行'])
    expect(selectExecution(useExecutionStore.getState(), TAB).status).toBe('running')
    再実行.応える(emptyResponse)
    await 実行
  })

  it('手放した後に返った続きの取り出しは項目を作り直さない', async () => {
    // Arrange
    const 続き = 手で返す<Chunk>()
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { exhausted: false }),
      onFetchMore: () => 続き.promise,
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])
    const 取り出し = useExecutionStore.getState().fetchMore('c1', TAB)

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    続き.返す({ rows: 行を作る(2, 2), exhausted: true })
    await 取り出し

    // Assert
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })

  it('手放した後に返った続きの取り出しの失敗も項目を作り直さない', async () => {
    // Arrange: 手放した結果セットの続きは取れなくて当然である
    const 続き = 手で返す<Chunk>()
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { exhausted: false }),
      onFetchMore: () => 続き.promise,
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])
    const 取り出し = useExecutionStore.getState().fetchMore('c1', TAB)

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    続き.失敗させる({ kind: 'closed', message: '結果セットは閉じられています' })
    await 取り出し

    // Assert
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })

  it('捨てた後に同じタブで実行し直すと古い続きの取り出しは新しい実行に混ざらない', async () => {
    // Arrange: 切断して繋ぎ直した後は同じタブで実行し直せる
    const 続き = 手で返す<Chunk>()
    const 再実行 = 保留の応答()
    let 回数 = 0
    const { api } = createFakeDbApi({
      onExecute: () => {
        回数 += 1
        return 回数 === 1 ? queryResponse(列, 行を作る(2), { exhausted: false }) : 再実行.promise
      },
      onFetchMore: () => 続き.promise,
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])
    const 取り出し = useExecutionStore.getState().fetchMore('c1', TAB)
    useExecutionStore.getState().clear()
    const 実行 = useExecutionStore.getState().execute('c2', TAB, 'select * from events', '開発', [])
    await 再実行.呼ばれるまで待つ()

    // Act
    続き.返す({ rows: 行を作る(2, 2), exhausted: true })
    await 取り出し

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('running')
    expect(execution.rows).toEqual([])
    再実行.応える(emptyResponse)
    await 実行
  })

  it('実行中に手放したタブは応答が返っても蘇らない', async () => {
    // Arrange: タブを閉じる経路は実行中かを見ない
    const 応答 = 保留の応答()
    const { api } = createFakeDbApi({ onExecute: () => 応答.promise })
    setDbApi(api)
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'update t set a = 1', '開発', [])
    await 応答.呼ばれるまで待つ()

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    応答.応える(statementResponse(1, { inTransaction: true }))
    await 実行

    // Assert: 文が走った事実はログと未コミットの表示に残す
    const state = useExecutionStore.getState()
    expect(state.byTab[TAB]).toBeUndefined()
    expect(state.inTransaction).toBe(true)
    expect(state.log).toHaveLength(1)
  })

  it('実行中に手放したタブは失敗が返っても蘇らない', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    let 失敗させる!: (error: unknown) => void
    setDbApi({
      ...api,
      execute: () =>
        new Promise<ExecuteResponse>((_, reject) => {
          失敗させる = reject
        }),
    })
    const 実行 = useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    失敗させる({ kind: 'execute', message: 'ORA-01013' })
    await 実行

    // Assert
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })

  it('スクリプト実行の最中に手放すと残りの文を投げずタブも蘇らない', async () => {
    // Arrange
    const 一文目 = 保留の応答()
    const 実行した: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した.push(sql)
        return sql === '文1' ? 一文目.promise : emptyResponse
      },
    })
    setDbApi(api)
    const 実行 = useExecutionStore
      .getState()
      .executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])
    await 一文目.呼ばれるまで待つ()

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    一文目.応える(emptyResponse)
    await 実行

    // Assert
    expect(実行した).toEqual(['文1'])
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })

  it('実行計画を取っている最中に手放すと計画は蘇らない', async () => {
    // Arrange
    const 計画 = 手で返す<string>()
    const { api } = createFakeDbApi()
    setDbApi({ ...api, explainPlan: () => 計画.promise })
    const 取得 = useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    計画.返す('Plan hash value: 0')
    await 取得

    // Assert
    expect(useExecutionStore.getState().planByTab[TAB]).toBeUndefined()
  })

  it('実行計画を取っている最中に手放すと失敗も書き戻されない', async () => {
    // Arrange
    const 計画 = 手で返す<string>()
    const { api } = createFakeDbApi()
    setDbApi({ ...api, explainPlan: () => 計画.promise })
    const 取得 = useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)
    計画.失敗させる({ kind: 'execute', message: 'ORA-00942' })
    await 取得

    // Assert
    expect(useExecutionStore.getState().planByTab[TAB]).toBeUndefined()
  })

  it('取り直した後に返った先の実行計画は後の計画を上書きしない', async () => {
    // Arrange
    const 先 = 手で返す<string>()
    const 後 = 手で返す<string>()
    const 応答 = [先, 後]
    const { api } = createFakeDbApi()
    setDbApi({ ...api, explainPlan: () => 応答.shift()!.promise })
    const 先の取得 = useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])
    const 後の取得 = useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select 2 from dual', 'estimate', [])
    後.返す('後の計画')
    await 後の取得

    // Act
    先.返す('先の計画')
    await 先の取得

    // Assert
    expect(useExecutionStore.getState().planByTab[TAB]?.text).toBe('後の計画')
  })

  it('巻き添えとして報されたタブが既に無ければ項目を作り直さない', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { discardedTab: 'tab-closed' }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    expect(useExecutionStore.getState().byTab['tab-closed']).toBeUndefined()
  })

  it('手放しに失敗しても閉じたタブの項目は残らない', async () => {
    // Arrange: 実行中のまま残ると切断が止まり続ける
    const { api } = createFakeDbApi()
    setDbApi({
      ...api,
      releaseTab: async () => {
        throw { kind: 'connectionLost', message: 'ORA-03113' }
      },
    })
    useExecutionStore.setState({ byTab: { [TAB]: { ...emptyExecution, status: 'running' } } })

    // Act
    const 手放し = useExecutionStore.getState().releaseTab('c1', TAB)

    // Assert: 失敗は握り潰さず呼び出し側へ返す
    await expect(手放し).rejects.toEqual({ kind: 'connectionLost', message: 'ORA-03113' })
    expect(useExecutionStore.getState().byTab[TAB]).toBeUndefined()
  })
})

describe('formatResultSummary', () => {
  it('カーソルが尽きたら行数と所要時間を並べる', () => {
    // Arrange
    const execution = {
      ...emptyExecution,
      status: 'succeeded' as const,
      rows: 行を作る(142),
      exhausted: true,
      elapsedMs: 84,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('142 行 · 84 ms')
  })

  it('取得中は読み込み済みの行数を出す', () => {
    // Arrange: 総行数はまだ分からない
    const execution = {
      ...emptyExecution,
      status: 'succeeded' as const,
      rows: 行を作る(1000),
      exhausted: false,
      elapsedMs: 84,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('1,000 行 読み込み済み')
  })

  it('問い合わせ以外では影響行数を出す', () => {
    // Arrange
    const execution = {
      ...emptyExecution,
      status: 'succeeded' as const,
      affectedRows: 3,
      isStatement: true,
      elapsedMs: 12,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('3 行 · 12 ms')
  })

  it('1 行も当たらなかった dml は 0 行と出す', () => {
    // Arrange
    const execution = {
      ...emptyExecution,
      status: 'succeeded' as const,
      affectedRows: 0,
      isStatement: true,
      elapsedMs: 12,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('0 行 · 12 ms')
  })

  it('行数の概念が無い文では完了しましたと出す', () => {
    // Arrange: DDL や PL/SQL ブロックがこれに当たる（ADR 0034）
    const execution = {
      ...emptyExecution,
      status: 'succeeded' as const,
      affectedRows: null,
      isStatement: true,
      elapsedMs: 12,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('完了しました · 12 ms')
  })

  it('実行中は実行中と出す', () => {
    // Arrange
    const execution = { ...emptyExecution, status: 'running' as const }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('実行中')
  })

  it('破棄されたタブはその旨を出す', () => {
    // Arrange
    const execution = { ...emptyExecution, status: 'discarded' as const }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('結果は破棄されました')
  })

  it('何も実行していないときは空になる', () => {
    // Arrange
    const execution = emptyExecution

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('')
  })
})

describe('selectResultTabs', () => {
  it('通常は結果タブだけを出す', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Act
    const tabs = selectResultTabs(useExecutionStore.getState(), TAB)

    // Assert
    expect(tabs).toEqual(['result'])
  })

  it('エラーが出たときはメッセージタブが加わる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => {
        throw { kind: 'execute', message: 'ORA-00942' }
      },
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from nowhere', '開発', [])

    // Act
    const tabs = selectResultTabs(useExecutionStore.getState(), TAB)

    // Assert
    expect(tabs).toEqual(['result', 'messages'])
  })

  it('データベースからの通知があるときもメッセージタブが加わる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => ({
        kind: 'statement' as const,
        affectedRows: 0,
        elapsedMs: 3,
        notices: ['小槌からの通知'],
        inTransaction: false,
        compilation: null,
        discardedTab: null,
      }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'begin say_hello; end;', '開発', [])

    // Act
    const tabs = selectResultTabs(useExecutionStore.getState(), TAB)

    // Assert
    expect(tabs).toEqual(['result', 'messages'])
  })
})

describe('noteFormatFailure（ADR 0024）', () => {
  it('整形できなかった理由をログへ 1 件残す', () => {
    // Arrange
    const 理由 = '整形の結果が元の SQL と食い違ったため、取りやめました。'

    // Act
    useExecutionStore.getState().noteFormatFailure(理由)

    // Assert
    const log = useExecutionStore.getState().log
    expect(log).toHaveLength(1)
    expect(log[0].error).toBe(理由)
  })

  it('整形の記録であることが分かる見出しを付ける', () => {
    // Arrange
    // 実行していないため、ログの見出しは SQL ではない。

    // Act
    useExecutionStore.getState().noteFormatFailure('整形できませんでした。')

    // Assert
    expect(useExecutionStore.getState().log[0].sql).toBe('SQL の整形')
  })

  it('実行していないため所要時間も行数も持たない', () => {
    // Arrange
    // 整形はデータベースへ行かない操作である。

    // Act
    useExecutionStore.getState().noteFormatFailure('整形できませんでした。')

    // Assert
    const entry = useExecutionStore.getState().log[0]
    expect(entry.elapsedMs).toBeNull()
    expect(entry.rowCount).toBeNull()
  })

  it('通知が無くてもメッセージタブが出る', () => {
    // Arrange
    useExecutionStore.getState().noteFormatFailure('整形できませんでした。')

    // Act
    const tabs = selectResultTabs(useExecutionStore.getState(), TAB)

    // Assert
    expect(tabs).toEqual(['result', 'messages'])
  })
})

describe('履歴への記録', () => {
  it('成功した実行は行数と所要時間つきで記録される', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    expect(calls.recordHistory).toHaveLength(1)
    expect(calls.recordHistory[0]).toMatchObject({
      sql: 'select 1 from dual',
      connectionName: '開発',
      rowCount: 2,
      succeeded: true,
      errorMessage: null,
    })
  })

  it('失敗した実行もエラーつきで記録される', async () => {
    const { api, calls } = createFakeDbApi({
      onExecute: () => {
        throw { kind: 'execute', message: 'ORA-00942' }
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select * from nowhere', '開発', [])

    // Assert
    expect(calls.recordHistory[0]).toMatchObject({
      succeeded: false,
      rowCount: null,
      errorMessage: 'ORA-00942',
    })
  })

  it('履歴の記録に失敗しても結果は保たれる', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => queryResponse(列, 行を作る(2)) })
    setDbApi({
      ...api,
      recordHistory: async () => {
        throw new Error('履歴を書けません')
      },
    })

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    expect(useExecutionStore.getState().byTab[TAB].status).toBe('succeeded')
    expect(useExecutionStore.getState().byTab[TAB].rows).toHaveLength(2)
  })
})

describe('実行計画', () => {
  it('見積りは explain_plan を呼び結果をタブに残す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ planText: 'Plan hash value: 1' })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Assert
    expect(calls.explainPlan).toHaveLength(1)
    expect(calls.actualPlan).toHaveLength(0)
    expect(useExecutionStore.getState().planByTab[TAB]).toEqual({
      status: 'succeeded',
      mode: 'estimate',
      text: 'Plan hash value: 1',
      error: null,
    })
  })

  it('実測付きは actual_plan を呼ぶ', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ planText: 'A-Rows' })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'actual', [])

    // Assert
    expect(calls.actualPlan).toHaveLength(1)
    expect(useExecutionStore.getState().planByTab[TAB].mode).toBe('actual')
  })

  it('実行計画は履歴に記録されない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Assert
    expect(calls.recordHistory).toHaveLength(0)
  })

  it('失敗するとエラーが残る', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi({
      ...api,
      explainPlan: async () => {
        throw { kind: 'execute', message: 'ORA-01031' }
      },
    })

    // Act
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Assert
    expect(useExecutionStore.getState().planByTab[TAB]).toMatchObject({
      status: 'failed',
      error: 'ORA-01031',
    })
  })

  it('実行計画を取ると結果ペインに実行計画タブが増える', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Assert
    expect(selectResultTabs(useExecutionStore.getState(), TAB)).toEqual(['result', 'plan'])
  })

  it('タブを閉じると実行計画も捨てられる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    await useExecutionStore.getState().generatePlan('c1', TAB, 'select 1 from dual', 'estimate', [])

    // Act
    await useExecutionStore.getState().releaseTab('c1', TAB)

    // Assert
    expect(useExecutionStore.getState().planByTab[TAB]).toBeUndefined()
  })
})

describe('markExhausted', () => {
  it('カーソルを尽きたものとして扱う', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { exhausted: false }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from events', '開発', [])

    // Act
    useExecutionStore.getState().markExhausted(TAB)

    // Assert
    expect(useExecutionStore.getState().byTab[TAB].exhausted).toBe(true)
  })

  it('実行していないタブには何もしない', () => {
    // Arrange
    const before = useExecutionStore.getState().byTab

    // Act
    useExecutionStore.getState().markExhausted('tab-x')

    // Assert
    expect(useExecutionStore.getState().byTab).toBe(before)
  })
})

describe('トランザクションの制御（ADR 0012）', () => {
  it('未コミットは実行結果の申告で置き換わる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1), { inTransaction: true }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'insert into t values (1)', '開発', [])

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(true)
  })

  it('未コミットでない実行の後は未コミットが立たない', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1), { inTransaction: false }),
    })
    setDbApi(api)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select 1 from dual', '開発', [])

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(false)
  })

  it('コミットすると未コミットが解消しログに 1 行残る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    await useExecutionStore.getState().commit('c1')

    // Assert
    expect(calls.commit).toEqual(['c1'])
    expect(useExecutionStore.getState().inTransaction).toBe(false)
    const log = useExecutionStore.getState().log
    expect(log).toHaveLength(1)
    expect(log[0].sql).toBe('コミット')
    expect(log[0].notices).toEqual(['コミットしました'])
    expect(log[0].error).toBeNull()
  })

  it('ロールバックすると未コミットが解消しログに 1 行残る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    await useExecutionStore.getState().rollback('c1')

    // Assert
    expect(calls.rollback).toEqual(['c1'])
    expect(useExecutionStore.getState().inTransaction).toBe(false)
    expect(useExecutionStore.getState().log[0].sql).toBe('ロールバック')
  })

  it('コミットに失敗したときは未コミットのままエラーをログへ残す', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      commitError: { kind: 'execute', message: 'ORA-02091: transaction rolled back' },
    })
    setDbApi(api)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    await useExecutionStore.getState().commit('c1')

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(true)
    expect(useExecutionStore.getState().log[0].error).toBe('ORA-02091: transaction rolled back')
  })

  it('コミットとロールバックのログはメッセージタブを呼び出す', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    await useExecutionStore.getState().commit('c1')

    // Assert
    expect(selectResultTabs(useExecutionStore.getState(), TAB)).toEqual(['result', 'messages'])
  })

  it('結果を捨てるとどの段階のタブの項目も消える', () => {
    // Arrange: 遷移表の clear() の矢印（docs/state/execution.d2）
    useExecutionStore.setState({
      byTab: {
        実行中: { ...emptyExecution, status: 'running' },
        失敗: { ...emptyExecution, status: 'failed' },
        破棄: { ...emptyExecution, status: 'discarded' },
        成功: { ...emptyExecution, status: 'succeeded' },
      },
    })

    // Act
    useExecutionStore.getState().clear()

    // Assert
    expect(useExecutionStore.getState().byTab).toEqual({})
  })

  it('続きを取り出している最中に接続が切れると破棄済みになる', () => {
    // Arrange: カーソルはサーバ側にもう無い（ADR 0026）
    useExecutionStore.setState({
      byTab: {
        [TAB]: { ...emptyExecution, status: 'succeeded', exhausted: false, loadingMore: true },
      },
    })

    // Act
    useExecutionStore.getState().noteConnectionLost('ORA-03113')

    // Assert
    expect(selectExecution(useExecutionStore.getState(), TAB).status).toBe('discarded')
  })

  it('結果を捨てると未コミットの記憶も消える', async () => {
    // Arrange
    useExecutionStore.setState({ inTransaction: true })

    // Act
    useExecutionStore.getState().clear()

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(false)
  })
})

describe('バインド変数の受け渡し', () => {
  it('実行では与えた値をそのまま窓口へ渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [
      { name: 'id', kind: 'number', value: '42' },
      { name: 'memo', kind: 'varchar2', value: null },
    ]

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', TAB, 'select * from users where id = :id', '開発', binds)

    // Assert
    expect(calls.execute[0].binds).toEqual(binds)
  })

  it('履歴にはバインド変数の値を記録しない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [{ name: 'id', kind: 'varchar2', value: '個人情報' }]

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', TAB, 'select * from users where id = :id', '開発', binds)

    // Assert
    expect(JSON.stringify(calls.recordHistory)).not.toContain('個人情報')
  })

  it('見積りの実行計画でも与えた値を窓口へ渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [{ name: 'id', kind: 'number', value: '42' }]

    // Act
    await useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select * from users where id = :id', 'estimate', binds)

    // Assert
    expect(calls.explainPlan[0].binds).toEqual(binds)
  })

  it('実測付きの実行計画でも与えた値を窓口へ渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [{ name: 'id', kind: 'number', value: '42' }]

    // Act
    await useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select * from users where id = :id', 'actual', binds)

    // Assert
    expect(calls.actualPlan[0].binds).toEqual(binds)
  })
})

describe('discardOpenCursors', () => {
  /**
   * 実行済みのタブを作る。
   *
   * @param exhausted カーソルを読み切っていたか
   */
  function 成功したタブ(exhausted: boolean): TabExecution {
    return {
      ...emptyExecution,
      status: 'succeeded',
      columns: 列,
      rows: 行を作る(2),
      exhausted,
      elapsedMs: 3,
    }
  }

  it('カーソルを開いたままだったタブは破棄済みになる', () => {
    // Arrange: 切れた接続のカーソルはサーバ側にもう無い（ADR 0026）
    const byTab = { a: 成功したタブ(false) }

    // Act
    const 次 = discardOpenCursors(byTab)

    // Assert
    expect(次.a.status).toBe('discarded')
  })

  it('読み切ったタブの結果はそのまま残る', () => {
    // Arrange: 行はすべてクライアント側にあり、接続が切れても正しいままである
    const byTab = { a: 成功したタブ(true) }

    // Act
    const 次 = discardOpenCursors(byTab)

    // Assert
    expect(次.a.status).toBe('succeeded')
    expect(次.a.rows).toHaveLength(2)
  })

  it('失敗したタブと何もしていないタブは触らない', () => {
    // Arrange
    const byTab = {
      a: { ...emptyExecution, status: 'failed' as const, error: 'ORA-00904', exhausted: false },
      b: emptyExecution,
    }

    // Act
    const 次 = discardOpenCursors(byTab)

    // Assert
    expect(次.a.status).toBe('failed')
    expect(次.b.status).toBe('idle')
  })
})

describe('接続が切れたときの記録（ADR 0026）', () => {
  it('未コミットの表示が降りる', async () => {
    // Arrange: 切れた時点で Oracle はロールバック済みである
    const { api } = createFakeDbApi({
      onExecute: () => ({ ...emptyResponse, inTransaction: true }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'update t set n = 1', 'dev', [])
    expect(useExecutionStore.getState().inTransaction).toBe(true)

    // Act
    useExecutionStore.getState().noteConnectionLost('ORA-02396: 最大アイドル時間を超過しました')

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(false)
  })

  it('未コミットがあったときはロールバックされたことをログへ残す', async () => {
    // Arrange: 黙って消すのが最も悪い
    const { api } = createFakeDbApi({
      onExecute: () => ({ ...emptyResponse, inTransaction: true }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'update t set n = 1', 'dev', [])

    // Act
    useExecutionStore.getState().noteConnectionLost('ORA-02396: 最大アイドル時間を超過しました')

    // Assert
    const 最後 = useExecutionStore.getState().log.at(-1)
    expect(最後?.sql).toBe('接続')
    expect(最後?.error).toContain('ORA-02396')
    expect(最後?.error).toContain('ロールバックされました')
    expect(最後?.error).toContain('別のセッション')
  })

  it('未コミットが無かったときはロールバックの文言を出さない', () => {
    // Arrange: 起きていないことを告げない
    useExecutionStore.setState({ inTransaction: false })

    // Act
    useExecutionStore.getState().noteConnectionLost('ORA-03113: 通信路が切れました')

    // Assert
    const 最後 = useExecutionStore.getState().log.at(-1)
    expect(最後?.error).toBe('ORA-03113: 通信路が切れました')
  })

  it('繋ぎ直せなかったことは押すたびにログへ残る', () => {
    // Arrange: 押した結果が分からないと、押したのかどうかも見分けられない
    useExecutionStore.setState({ inTransaction: false })

    // Act
    useExecutionStore.getState().noteReconnectFailure('ORA-12541: TNS:no listener')
    useExecutionStore.getState().noteReconnectFailure('ORA-12541: TNS:no listener')

    // Assert
    const 接続の行 = useExecutionStore.getState().log.filter((entry) => entry.sql === '接続')
    expect(接続の行).toHaveLength(2)
    expect(接続の行[0].error).toContain('繋ぎ直せませんでした')
    expect(接続の行[0].error).toContain('ORA-12541')
  })

  it('開いたままだった結果セットは破棄済みになる', async () => {
    // Arrange: 千行ちょうど返れば、まだ続きがあるかは分からずカーソルが残る
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(1000), { exhausted: false }),
    })
    setDbApi(api)
    await useExecutionStore.getState().execute('c1', TAB, 'select * from t', 'dev', [])

    // Act
    useExecutionStore.getState().noteConnectionLost('ORA-03113')

    // Assert
    expect(useExecutionStore.getState().byTab[TAB].status).toBe('discarded')
  })
})

describe('formatStatementOutcome（結果ペインの本文）', () => {
  it('dml では影響行数を出す', () => {
    // Arrange
    const affectedRows = 1234

    // Act
    const text = formatStatementOutcome(affectedRows)

    // Assert
    expect(text).toBe('1,234 行に影響しました')
  })

  it('1 行も当たらなかった dml では 0 行と出す', () => {
    // Arrange
    const affectedRows = 0

    // Act
    const text = formatStatementOutcome(affectedRows)

    // Assert
    expect(text).toBe('0 行に影響しました')
  })

  it('行数の概念が無い文では完了しましたと出す', () => {
    // Arrange: DDL や PL/SQL ブロックがこれに当たる（ADR 0034）
    const affectedRows = null

    // Act
    const text = formatStatementOutcome(affectedRows)

    // Assert
    expect(text).toBe('完了しました')
  })
})

describe('コンパイルエラー（ADR 0045）', () => {
  const 報告 = {
    warning: 'ORA-24344: A compilation error occurred while creating an object.',
    diagnostics: [
      {
        owner: 'KODUCHI',
        name: 'BROKEN',
        objectType: 'PROCEDURE',
        line: 3,
        position: 3,
        severity: 'error' as const,
        text: "PLS-00201: identifier 'NUL' must be declared",
      },
    ],
    lookupError: null,
  }

  it('報告の付いた文は完了ではなく失敗として行と桁つきで出る', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => statementResponse(null, { compilation: 報告 }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', TAB, 'create or replace procedure broken is ...', '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('failed')
    expect(execution.error).toContain('KODUCHI.BROKEN（PROCEDURE）\n  3 行 3 桁: PLS-00201')
    expect(execution.compilationFailed).toBe(true)
    const [entry] = useExecutionStore.getState().log
    expect(entry.error).toBe(execution.error)
    expect(entry.rowCount).toBeNull()
  })

  it('報告の付いた文でも未コミットの表示と通知は応答の値を使う', async () => {
    // Arrange: 文そのものは走り切っており、DDL の暗黙のコミットも起きている
    useExecutionStore.setState({ inTransaction: true })
    const { api } = createFakeDbApi({
      onExecute: () =>
        statementResponse(null, {
          compilation: 報告,
          inTransaction: false,
          notices: ['小槌からの通知'],
        }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'create ...', '開発', [])

    // Assert
    expect(useExecutionStore.getState().inTransaction).toBe(false)
    expect(useExecutionStore.getState().log[0].notices).toEqual(['小槌からの通知'])
  })

  it('報告の付いた文は履歴に失敗として残る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({
      onExecute: () => statementResponse(null, { compilation: 報告 }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'create ...', '開発', [])

    // Assert
    expect(calls.recordHistory[0]).toMatchObject({ succeeded: false, rowCount: null })
    expect(calls.recordHistory[0].errorMessage).toContain('PLS-00201')
  })

  it('スクリプト実行は報告の付いた文で止まる', async () => {
    // Arrange: 無効なオブジェクトを前提に後続の文を流させない
    const 実行した順: string[] = []
    const { api } = createFakeDbApi({
      onExecute: (sql) => {
        実行した順.push(sql)
        return sql === '文2' ? statementResponse(null, { compilation: 報告 }) : emptyResponse
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().executeScript('c1', TAB, ['文1', '文2', '文3'], '開発', [])

    // Assert
    expect(実行した順).toEqual(['文1', '文2'])
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('failed')
    expect(execution.progress).toEqual({ index: 2, total: 3 })
  })

  it('報告の付いた文の巻き添えで閉じられたタブは破棄済みになる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => statementResponse(null, { compilation: 報告, discardedTab: 'tab-a' }),
    })
    setDbApi(api)
    useExecutionStore.setState({
      byTab: { 'tab-a': { ...emptyExecution, status: 'succeeded', exhausted: false } },
    })

    // Act
    await useExecutionStore.getState().execute('c1', 'tab-b', 'create ...', '開発', [])

    // Assert
    expect(selectExecution(useExecutionStore.getState(), 'tab-a').status).toBe('discarded')
    expect(selectExecution(useExecutionStore.getState(), 'tab-b').status).toBe('failed')
  })

  it('報告を読めなかった文も失敗として出し未コミットの表示と通知は応答の値を使う', async () => {
    // Arrange: 文は走り切っており、報告の取得だけが中止された
    useExecutionStore.setState({ inTransaction: true })
    const { api } = createFakeDbApi({
      onExecute: () =>
        statementResponse(null, {
          compilation: {
            ...報告,
            diagnostics: [],
            lookupError: 'コンパイルエラーの内容を読めませんでした: ORA-01013',
          },
          inTransaction: false,
          notices: ['小槌からの通知'],
        }),
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'create ...', '開発', [])

    // Assert
    const execution = selectExecution(useExecutionStore.getState(), TAB)
    expect(execution.status).toBe('failed')
    expect(execution.error).toContain('コンパイルエラーの内容を読めませんでした: ORA-01013')
    expect(useExecutionStore.getState().inTransaction).toBe(false)
    expect(useExecutionStore.getState().log[0].notices).toEqual(['小槌からの通知'])
  })

  it('例外で返った失敗はコンパイルエラーとして扱わない', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => {
        throw { kind: 'execute', message: 'ORA-00942' }
      },
    })
    setDbApi(api)

    // Act
    await useExecutionStore.getState().execute('c1', TAB, 'select * from nowhere', '開発', [])

    // Assert
    expect(selectExecution(useExecutionStore.getState(), TAB).compilationFailed).toBe(false)
  })
})
