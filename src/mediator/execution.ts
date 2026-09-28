/**
 * 実行の裁定（ADR の「SQL の実行単位」「バインド変数」「実行計画」節・ADR 0035）。
 *
 * `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` の実行と、`⌘E` / `⇧⌘E` の実行計画は、どれも同じ流れを
 * 通る。対象の SQL を切り出し、バインド変数があれば値を尋ね、結果ペインの見る
 * タブを切り替えてから実行のストアへ渡す。タブ・スキーマ・実行・履歴・画面の
 * 5 つのストアにまたがるため、仲介者に置く。
 *
 * エディタのカーソルは画面にしか無いため、呼び出し側から受け取る。
 */

import { getDialogApi } from '../api/dialog'
import { inferBindKinds } from '../sql/bindTypes'
import type { RunScope, RunTarget } from '../sql/runTarget'
import { runTargetOf } from '../sql/runTarget'
import type { BindOccurrence } from '../sql/statements'
import {
  collectBindOccurrences,
  collectBindOccurrencesAcross,
  collectBindVariables,
  collectBindVariablesAcross,
  isSelectStatement,
} from '../sql/statements'
import { useConnectionStore } from '../stores/connection'
import { useExecutionStore } from '../stores/execution'
import { useHistoryStore } from '../stores/history'
import { useSchemaStore } from '../stores/schema'
import {
  fillBindDefaults,
  selectActiveSqlTab,
  selectBindValues,
  toBinds,
  useTabStore,
} from '../stores/tab'
import { useUiStore } from '../stores/ui'
import type { Bind } from '../types/db'
import type { Ask } from './ask'

/**
 * エディタのカーソル。実行の対象を決めるのに要る分だけを持つ。
 *
 * `SqlEditor` の `EditorPosition` はこの形を満たす。仲介者はエディタの部品を
 * import しない（ADR 0035）。
 */
export interface EditorCursor {
  /** 文書の先頭からの位置。カーソル位置の文を探すのに使う。 */
  offset: number
  /** 選択している文字列。選択が無ければ `null`。 */
  selectedText: string | null
}

/** 実行に要る、画面にしか無いもの。 */
export interface RunScreen {
  /** 押された時点のカーソル。 */
  cursor: EditorCursor
  /** 利用者への尋ね方。バインド変数の値を尋ねるのに使う。 */
  ask: Ask
  /**
   * 流す文をエディタの上で一瞬光らせる（ADR 0047）。
   *
   * 光らせる範囲は、ここで実際に流すと決めた文そのものを渡す。エディタが
   * 自分で決め直すと、流した文と光った範囲がずれうる。エディタが描かれて
   * いなければ省いてよい。
   */
  highlight?: (target: RunTarget) => void
}

/**
 * 値が揃ってから行う実行（ADR の「バインド変数」節）。
 *
 * `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` の実行と、`⌘E` / `⇧⌘E` の実行計画のどれもここへ載せる。
 */
export type PendingRun =
  | { kind: 'execute'; sql: string }
  | { kind: 'plan'; sql: string; actual: boolean }
  /** `⌥⌘⏎`。切り出した文を順に実行する。値は全文で使い回す。 */
  | { kind: 'script'; statements: string[] }

/**
 * 実行の対象からバインド変数の名前を集める。
 *
 * スクリプト実行では、1 文ごとに尋ねずに全文ぶんをまとめて 1 度だけ尋ねる。
 *
 * @param run 値が揃うのを待っている実行
 */
export function bindVariablesOf(run: PendingRun): string[] {
  return run.kind === 'script'
    ? collectBindVariablesAcross(run.statements)
    : collectBindVariables(run.sql)
}

/**
 * 実行の対象からバインド変数の出てくる場所を集める。
 *
 * 既定の型を推し量るのに使う（ADR 0016）。
 *
 * @param run 値が揃うのを待っている実行
 */
function bindOccurrencesOf(run: PendingRun): BindOccurrence[] {
  return run.kind === 'script'
    ? collectBindOccurrencesAcross(run.statements)
    : collectBindOccurrences(run.sql)
}

/** 実行を受け付けられる接続とタブ。 */
interface RunContext {
  connection: NonNullable<ReturnType<typeof useConnectionStore.getState>['connection']>
  tabId: string
}

/**
 * 今この実行に入れるかを決める（ADR 0047）。入れなければ `null`。
 *
 * 光らせる前の判定と、値が揃って実際に流す直前の判定の両方がここを通る。
 * 2 か所で別々に見ると、流れないのに光る（表示が嘘をつく）経路が生まれる。
 *
 * 実行中のタブを弾くのは `execution` ストアの `execute` / `executeScript` の
 * 関所と同じ条件である。ストアは黙って戻るため、先にここで見ないと光った後に
 * 何も起きない。実行計画はストアが実行中を弾かないので、ここでも弾かない。
 *
 * @param kind 行う実行の種類
 */
function runContextFor(kind: PendingRun['kind']): RunContext | null {
  const connection = useConnectionStore.getState().connection
  const tabId = useTabStore.getState().activeTabId
  if (!connection || !tabId) {
    return null
  }
  if (kind !== 'plan' && useExecutionStore.getState().byTab[tabId]?.status === 'running') {
    return null
  }
  return { connection, tabId }
}

/**
 * 値が揃った実行を行う。
 *
 * 実行と実行計画のどちらもここを通る。バインド変数を尋ねる経路を 1 本に
 * まとめるためである。対象のタブは値が決まった時点で選ばれているものである。
 *
 * @param run 行う実行
 * @param binds バインド変数の値
 */
async function runPending(run: PendingRun, binds: Bind[]): Promise<void> {
  const context = runContextFor(run.kind)
  if (!context) {
    return
  }
  const { connection, tabId } = context

  const execution = useExecutionStore.getState()
  const selectResultTab = useUiStore.getState().selectResultTab

  if (run.kind === 'execute') {
    selectResultTab('result')
    await execution.execute(connection.id, tabId, run.sql, connection.name, binds)
    // 履歴は実行のたびに増える。開いていれば読み直す。
    await useHistoryStore.getState().reload()
    return
  }

  if (run.kind === 'script') {
    selectResultTab('result')
    await execution.executeScript(connection.id, tabId, run.statements, connection.name, binds)
    await useHistoryStore.getState().reload()
    return
  }

  selectResultTab('plan')
  await execution.generatePlan(
    connection.id,
    tabId,
    run.sql,
    run.actual ? 'actual' : 'estimate',
    binds,
  )
}

/**
 * 実行に取りかかる。
 *
 * SQL にバインド変数が含まれていれば、その値を尋ねてからにする
 * （ADR の「バインド変数」節）。値そのものはタブストアに覚えさせてあり、
 * 答えが「実行」なら、その時点の値を読んで実行する。
 *
 * @param run 行う実行
 * @param ask 利用者への尋ね方
 */
export async function startRun(run: PendingRun, ask: Ask): Promise<void> {
  const names = bindVariablesOf(run)
  if (names.length === 0) {
    await runPending(run, [])
    return
  }

  // 初めて尋ねる変数には、比べている列から推し量った型を入れておく
  // （ADR 0016）。覚えている変数はそのまま残す。
  const tabId = useTabStore.getState().activeTabId
  if (tabId) {
    const kinds = inferBindKinds(bindOccurrencesOf(run), useSchemaStore.getState().columns)
    const values = selectBindValues(useTabStore.getState(), tabId)
    useTabStore.getState().setBindValues(tabId, fillBindDefaults(names, values, kinds))
  }

  if (!(await ask({ kind: 'binds', names }))) {
    return
  }

  const values = selectBindValues(useTabStore.getState(), useTabStore.getState().activeTabId)
  await runPending(run, toBinds(names, values))
}

/**
 * 押された時点の実行の対象を決める。定義タブを選んでいるときは無い（ADR 0022）。
 *
 * @param scope 実行の単位
 * @param cursor 押された時点のカーソル
 */
function targetOf(scope: RunScope, cursor: EditorCursor): RunTarget | null {
  const tab = selectActiveSqlTab(useTabStore.getState())
  return tab ? runTargetOf(scope, tab.content, cursor) : null
}

/**
 * カーソル位置の文、または選択範囲の文を取り出す。
 *
 * 実行計画は 1 文にしか取れないため、選択範囲に複数の文があれば最初の 1 文を
 * 返す。定義タブを選んでいるときは SQL が無い（ADR 0022）。
 *
 * @param cursor 押された時点のカーソル
 * @param selectionOnly 選択範囲だけを取り出すか
 */
export function currentSql(cursor: EditorCursor, selectionOnly: boolean): string | null {
  return targetOf(selectionOnly ? 'selection' : 'statement', cursor)?.statements[0]?.text ?? null
}

/**
 * 流す文を光らせてから実行に取りかかる。
 *
 * 実行に入れないとき（未接続・同じタブが実行中）は光らせもしない。バインド
 * 変数のダイアログで取り消されたときは光った後に何も流れないが、何を流すかを
 * 見せてから尋ねるための光なので、それは残す（ADR 0047）。
 *
 * @param run 行う実行
 * @param target 光らせる文
 * @param screen 押された時点の画面
 */
function beginRun(run: PendingRun, target: RunTarget, screen: RunScreen): void {
  if (!runContextFor(run.kind)) {
    return
  }
  screen.highlight?.(target)
  void startRun(run, screen.ask)
}

/**
 * `⌘⏎`。カーソル位置の文を実行する。
 *
 * @param screen 押された時点のカーソルと尋ね方
 */
export function runStatement(screen: RunScreen): void {
  const target = targetOf('statement', screen.cursor)
  if (target && target.statements.length > 0) {
    beginRun({ kind: 'execute', sql: target.statements[0].text }, target, screen)
  }
}

/**
 * `⇧⌘⏎`。選択範囲を実行する。選択が無ければ何もしない。
 *
 * 選択範囲に複数の文があればスクリプト実行（`⌥⌘⏎`）と同じく順に実行する。
 * Oracle は 1 度に 1 文しか受け取らないため、まとめて渡す道は無い。
 *
 * @param screen 押された時点のカーソルと尋ね方
 */
export function runSelection(screen: RunScreen): void {
  const target = targetOf('selection', screen.cursor)
  const statements = target?.statements.map((statement) => statement.text) ?? []
  if (!target || statements.length === 0) {
    return
  }
  beginRun(
    statements.length === 1
      ? { kind: 'execute', sql: statements[0] }
      : { kind: 'script', statements },
    target,
    screen,
  )
}

/**
 * `⌥⌘⏎`。タブ全体の文を順に実行する。
 *
 * 選択範囲があるときは、その中の文だけを順に実行する。バインド変数があれば
 * 実行を始める前に全文ぶんまとめて尋ねる。途中で失敗したら以降の文は
 * 実行しない（`executeScript` が判断する）。
 *
 * @param screen 押された時点のカーソルと尋ね方
 */
export function runScript(screen: RunScreen): void {
  const target = targetOf('script', screen.cursor)
  if (target && target.statements.length > 0) {
    const statements = target.statements.map((statement) => statement.text)
    beginRun({ kind: 'script', statements }, target, screen)
  }
}

/** 実測付きの実行計画の前に、問い合わせ以外を実行してよいかを尋ねる文言。 */
const ACTUAL_PLAN_QUESTION =
  'この文は問い合わせではありません。実測付きの実行計画を取るには、実際に実行する必要があります。実行しますか？'

/**
 * `⌘E` / `⇧⌘E`。実行計画を出す。
 *
 * 実測付き（`⇧⌘E`）は SQL を実際に実行するため、問い合わせ以外に対しては
 * 事前に確認を取る（ADR の「実行計画」節）。
 *
 * @param actual 実測付きか
 * @param screen 押された時点のカーソルと尋ね方
 */
export async function runPlan(actual: boolean, screen: RunScreen): Promise<void> {
  if (!runContextFor('plan')) {
    return
  }
  const target = targetOf(
    screen.cursor.selectedText !== null ? 'selection' : 'statement',
    screen.cursor,
  )
  // 計画は 1 文にしか取れない。光らせるのも取る 1 文だけにする。
  const statement = target?.statements[0]
  if (!target || !statement) {
    return
  }
  const sql = statement.text
  // 押した瞬間に光らせる。確認やバインド変数のダイアログは、何を流すかを
  // 見せた後に出るほうが答えやすい。
  screen.highlight?.({ origin: target.origin, statements: [statement] })

  if (actual && !isSelectStatement(sql)) {
    const 続ける = await getDialogApi().confirm(ACTUAL_PLAN_QUESTION, {
      title: '実測付きの実行計画',
      kind: 'warning',
    })
    if (!続ける) {
      return
    }
  }

  await startRun({ kind: 'plan', sql, actual }, screen.ask)
}

/** `⌘.`。選択中のタブの実行を中止する。 */
export function cancelExecution(): void {
  const connection = useConnectionStore.getState().connection
  const tabId = useTabStore.getState().activeTabId
  if (connection && tabId) {
    void useExecutionStore.getState().cancel(connection.id, tabId)
  }
}

/** 結果の続きを取りにいく（ADR 0003）。 */
export function requestMore(): void {
  const connection = useConnectionStore.getState().connection
  const tabId = useTabStore.getState().activeTabId
  if (connection && tabId) {
    void useExecutionStore.getState().fetchMore(connection.id, tabId)
  }
}

/**
 * 整形できなかったことをメッセージタブへ出す（ADR 0024）。
 *
 * 押した本人が結果を見に行かないと気づけないのでは、押した意味が分からない。
 * 記録を積んだうえでメッセージタブへ切り替える。**本文には触れていない。**
 *
 * @param message 整形できなかった理由
 */
export function reportFormatFailure(message: string): void {
  useExecutionStore.getState().noteFormatFailure(message)
  useUiStore.getState().selectResultTab('messages')
}
