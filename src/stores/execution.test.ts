import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, queryResponse } from '../test/fakeDbApi'
import {
  emptyExecution,
  formatResultSummary,
  selectExecution,
  selectResultTabs,
  useExecutionStore,
} from './execution'
import type { Bind, Cell, Column } from '../types/db'

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

beforeEach(() => {
  useExecutionStore.getState().clear()
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
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => queryResponse(列, 行を作る(2), { discardedTab: 'tab-a' }),
    })
    setDbApi(api)

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
      elapsedMs: 12,
    }

    // Act
    const summary = formatResultSummary(execution)

    // Assert
    expect(summary).toBe('3 行 · 12 ms')
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

describe('バインド変数の受け渡し', () => {
  it('実行では与えた値をそのまま窓口へ渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const binds: Bind[] = [
      ['id', '42'],
      ['memo', null],
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
    const binds: Bind[] = [['id', '個人情報']]

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
    const binds: Bind[] = [['id', '42']]

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
    const binds: Bind[] = [['id', '42']]

    // Act
    await useExecutionStore
      .getState()
      .generatePlan('c1', TAB, 'select * from users where id = :id', 'actual', binds)

    // Assert
    expect(calls.actualPlan[0].binds).toEqual(binds)
  })
})
