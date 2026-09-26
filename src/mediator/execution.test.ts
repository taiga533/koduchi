import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { resetDialogApi, setDialogApi } from '../api/dialog'
import { createFakeDbApi, emptyResponse } from '../test/fakeDbApi'
import { createFakeDialogApi } from '../test/fakeDialogApi'
import { SQLタブを一枚にする, 接続済みにする } from '../test/activeConnection'
import { emptyExecution, useExecutionStore } from '../stores/execution'
import { emptyBindInput, useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import type { Ask, AskRequest } from './ask'
import type { EditorCursor, RunScreen } from './execution'
import {
  bindVariablesOf,
  cancelExecution,
  currentSql,
  reportFormatFailure,
  requestMore,
  runPlan,
  runScript,
  runSelection,
  runStatement,
  startRun,
} from './execution'

beforeEach(() => {
  useExecutionStore.getState().clear()
  useUiStore.setState({ resultTab: 'result' })
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
  resetDialogApi()
})

/** カーソルが文書の先頭にあり、選択していない。 */
const 先頭: EditorCursor = { offset: 0, selectedText: null }

/**
 * バインド変数を尋ねられたら決めた答えを返す尋ね方を作る。
 *
 * @param 答え 「この値で実行」を押すか
 * @param 値 押す前に打ったことにする値
 */
function 尋ね方(答え = true, 値: Record<string, string> = {}): { ask: Ask; 尋ねた: AskRequest[] } {
  const 尋ねた: AskRequest[] = []
  const ask = (async (request: AskRequest) => {
    尋ねた.push(request)
    const tabId = useTabStore.getState().activeTabId
    if (tabId) {
      const current = useTabStore.getState().bindValues[tabId] ?? {}
      const next = { ...current }
      for (const [name, value] of Object.entries(値)) {
        next[name] = { ...emptyBindInput, ...current[name], text: value, isNull: false }
      }
      useTabStore.getState().setBindValues(tabId, next)
    }
    return 答え
  }) as Ask
  return { ask, 尋ねた }
}

/**
 * 実行の画面を作る。
 *
 * @param cursor カーソル
 * @param ask 尋ね方
 */
function 画面(cursor: EditorCursor, ask: Ask = 尋ね方().ask): RunScreen {
  return { cursor, ask }
}

describe('bindVariablesOf', () => {
  it('すべて実行では全文のバインド変数を重ねずに集める', () => {
    // Arrange
    const run = {
      kind: 'script' as const,
      statements: ['insert into t values (:id)', 'update t set n = :name where id = :id'],
    }

    // Act
    const names = bindVariablesOf(run)

    // Assert
    expect(names).toEqual(['id', 'name'])
  })
})

describe('currentSql', () => {
  it('カーソル位置の文を取り出す', () => {
    // Arrange
    SQLタブを一枚にする({ content: 'select 1 from dual;\nselect 2 from dual;' })

    // Act
    const sql = currentSql({ offset: 25, selectedText: null }, false)

    // Assert
    expect(sql).toBe('select 2 from dual')
  })

  it('カーソル位置の PL_SQL ブロックは END のセミコロンまでを取り出す', () => {
    // Arrange
    SQLタブを一枚にする({ content: 'select 1 from dual;\nbegin null; end;' })

    // Act
    const sql = currentSql({ offset: 25, selectedText: null }, false)

    // Assert
    expect(sql).toBe('begin null; end;')
  })

  it('定義タブを選んでいるときは SQL が無い', () => {
    // Arrange
    SQLタブを一枚にする()
    useTabStore.getState().openDefinitionTab({ owner: 'KODUCHI', name: 'USERS', kind: 'table' })

    // Act
    const sql = currentSql(先頭, false)

    // Assert
    expect(sql).toBeNull()
  })
})

describe('runStatement', () => {
  it('カーソル位置の文を実行し、結果タブを見せる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })
    useUiStore.setState({ resultTab: 'messages' })

    // Act
    runStatement(画面(先頭))

    // Assert
    await expect.poll(() => calls.execute.map((call) => call.sql)).toEqual(['select 1 from dual'])
    expect(useUiStore.getState().resultTab).toBe('result')
  })

  it('バインド変数が無ければ尋ねない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })
    const { ask, 尋ねた } = 尋ね方()

    // Act
    runStatement(画面(先頭, ask))

    // Assert
    await expect.poll(() => calls.execute).toHaveLength(1)
    expect(尋ねた).toEqual([])
  })
})

describe('runSelection', () => {
  it('選択が無ければ何もしない', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    runSelection(画面(先頭))

    // Assert
    expect(calls.execute).toEqual([])
  })

  it('選択した文字列だけを実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    runSelection(画面({ offset: 0, selectedText: 'select 1' }))

    // Assert
    await expect.poll(() => calls.execute.map((call) => call.sql)).toEqual(['select 1'])
  })

  it('選択した文の末尾のセミコロンは渡さない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual;' })

    // Act
    runSelection(画面({ offset: 0, selectedText: 'select 1 from dual;' }))

    // Assert
    await expect.poll(() => calls.execute.map((call) => call.sql)).toEqual(['select 1 from dual'])
  })

  it('セミコロンで終わる複数の文を選ぶと 1 文ずつ順に実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    const content = 'select 1 from dual;\nselect 2 from dual;'
    SQLタブを一枚にする({ content })

    // Act
    runSelection(画面({ offset: content.length, selectedText: content }))

    // Assert
    await expect
      .poll(() => calls.execute.map((call) => call.sql))
      .toEqual(['select 1 from dual', 'select 2 from dual'])
  })

  it('選択した PL_SQL ブロックは END のセミコロンまで渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'begin null; end;' })

    // Act
    runSelection(画面({ offset: 0, selectedText: 'begin null; end;' }))

    // Assert
    await expect.poll(() => calls.execute.map((call) => call.sql)).toEqual(['begin null; end;'])
  })

  it('コメントだけを選んでも何もしない', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: '-- memo' })

    // Act
    runSelection(画面({ offset: 0, selectedText: '-- memo' }))

    // Assert
    expect(calls.execute).toEqual([])
  })
})

describe('runScript', () => {
  it('タブの文を順に実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'create table t (n number);\ninsert into t values (1);' })

    // Act
    runScript(画面(先頭))

    // Assert
    await expect
      .poll(() => calls.execute.map((call) => call.sql))
      .toEqual(['create table t (n number)', 'insert into t values (1)'])
  })

  it('PL_SQL ブロックは END のセミコロンまで、SQL はセミコロンを落として渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする({ content: 'begin null; end;\nselect 1 from dual;' })

    // Act
    runScript(画面(先頭))

    // Assert
    await expect
      .poll(() => calls.execute.map((call) => call.sql))
      .toEqual(['begin null; end;', 'select 1 from dual'])
  })
})

describe('startRun', () => {
  it('バインド変数があれば 1 度だけ尋ね、打った値を添えて実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => emptyResponse })
    setDbApi(api)
    SQLタブを一枚にする()
    const { ask, 尋ねた } = 尋ね方(true, { id: '7' })

    // Act
    await startRun({ kind: 'execute', sql: 'select * from t where id = :id' }, ask)

    // Assert
    expect(尋ねた).toEqual([{ kind: 'binds', names: ['id'] }])
    expect(calls.execute).toHaveLength(1)
    expect(calls.execute[0].binds).toMatchObject([{ name: 'id', value: '7' }])
  })

  it('尋ねた値を取り消されたら実行しない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    const { ask } = 尋ね方(false)

    // Act
    await startRun({ kind: 'execute', sql: 'select * from t where id = :id' }, ask)

    // Assert
    expect(calls.execute).toEqual([])
  })

  it('尋ねる前に、初めての変数へ既定の型を入れておく', async () => {
    // Arrange: 覚えている値が無いまま尋ねると、欄が空の型で出てしまう（ADR 0016）
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする()
    let 尋ねた時点の値: unknown = null
    const ask = (async () => {
      尋ねた時点の値 = useTabStore.getState().bindValues['sql-1']
      return false
    }) as Ask

    // Act
    await startRun({ kind: 'execute', sql: 'select :id from dual' }, ask)

    // Assert
    expect(尋ねた時点の値).toMatchObject({ id: { kind: expect.any(String) } })
  })
})

describe('runPlan', () => {
  it('見積りの実行計画を取り、実行計画のタブを見せる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    await runPlan(false, 画面(先頭))

    // Assert
    expect(calls.explainPlan.map((call) => call.sql)).toEqual(['select 1 from dual'])
    expect(useUiStore.getState().resultTab).toBe('plan')
  })

  it('問い合わせ以外の実測付きは確かめてから取る', async () => {
    // Arrange: 実測付きは SQL を実際に実行する
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const dialog = createFakeDialogApi({ confirm: true })
    setDialogApi(dialog.api)
    SQLタブを一枚にする({ content: 'delete from t' })

    // Act
    await runPlan(true, 画面(先頭))

    // Assert
    expect(dialog.calls.confirm).toHaveLength(1)
    expect(calls.actualPlan.map((call) => call.sql)).toEqual(['delete from t'])
  })

  it('問い合わせ以外の実測付きを断られたら取らない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    setDialogApi(createFakeDialogApi({ confirm: false }).api)
    SQLタブを一枚にする({ content: 'delete from t' })

    // Act
    await runPlan(true, 画面(先頭))

    // Assert
    expect(calls.actualPlan).toEqual([])
  })

  it('問い合わせの実測付きは確かめずに取る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const dialog = createFakeDialogApi()
    setDialogApi(dialog.api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    await runPlan(true, 画面(先頭))

    // Assert
    expect(dialog.calls.confirm).toEqual([])
    expect(calls.actualPlan).toHaveLength(1)
  })

  it('選択があれば選択した文字列の実行計画を取る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual;\nselect 2 from dual' })

    // Act
    await runPlan(false, 画面({ offset: 0, selectedText: 'select 2 from dual' }))

    // Assert
    expect(calls.explainPlan.map((call) => call.sql)).toEqual(['select 2 from dual'])
  })

  it('選択に複数の文があれば最初の文の実行計画をセミコロン抜きで取る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const content = 'select 1 from dual;\nselect 2 from dual;'
    SQLタブを一枚にする({ content })

    // Act
    await runPlan(false, 画面({ offset: 0, selectedText: content }))

    // Assert
    expect(calls.explainPlan.map((call) => call.sql)).toEqual(['select 1 from dual'])
  })
})

describe('cancelExecution / requestMore', () => {
  it('選んでいるタブの実行を中止する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    useExecutionStore.setState({ byTab: { 'sql-1': { ...emptyExecution, status: 'running' } } })

    // Act
    cancelExecution()

    // Assert
    await expect.poll(() => calls.cancel).toEqual([{ id: 'c1', tabId: 'sql-1' }])
  })

  it('選んでいるタブの結果の続きを取りにいく', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    useExecutionStore.setState({
      byTab: { 'sql-1': { ...emptyExecution, status: 'succeeded', exhausted: false } },
    })

    // Act
    requestMore()

    // Assert
    await expect.poll(() => calls.fetchMore).toEqual([{ id: 'c1', tabId: 'sql-1' }])
  })
})

describe('reportFormatFailure', () => {
  it('整形できなかったことをメッセージタブへ残し、そこを見せる', () => {
    // Arrange
    useUiStore.setState({ resultTab: 'result' })

    // Act
    reportFormatFailure('字句の並びが変わるため整形を取りやめました')

    // Assert
    expect(useUiStore.getState().resultTab).toBe('messages')
    expect(useExecutionStore.getState().log.at(-1)?.error).toContain('整形を取りやめました')
  })
})
