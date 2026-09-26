import { ResultPane, useExecutionStore, useUiStore } from 'koduchi-ui'
import type { Cell, Column, TabExecution } from 'koduchi-ui'

// 実行の状態はストアの `byTab` にタブ ID ごとに入る。見本ごとに別のタブ ID を
// 渡すことで、1 つのストアのまま状態違いを並べる。

const columns: Column[] = [
  { name: 'EMPLOYEE_ID', typeName: 'NUMBER(6)', kind: 'number' },
  { name: 'LAST_NAME', typeName: 'VARCHAR2(25)', kind: 'text' },
  { name: 'DEPARTMENT', typeName: 'VARCHAR2(30)', kind: 'text' },
  { name: 'SALARY', typeName: 'NUMBER(8,2)', kind: 'number' },
  { name: 'COMMISSION_PCT', typeName: 'NUMBER(2,2)', kind: 'number' },
]

const t = (text: string): Cell => ({ text, kind: 'text' })
const n = (text: string): Cell => ({ text, kind: 'number' })
const nul: Cell = { text: '', kind: 'null' }

const rows: Cell[][] = [
  [n('100'), t('King'), t('経営企画部'), n('24000.00'), nul],
  [n('101'), t('Kochhar'), t('経営企画部'), n('17000.00'), nul],
  [n('103'), t('Hunold'), t('情報システム部'), n('9000.00'), nul],
  [n('145'), t('Russell'), t('営業部'), n('14000.00'), n('0.40')],
  [n('146'), t('Partners'), t('営業部'), n('13500.00'), n('0.30')],
  [n('108'), t('Greenberg'), t('経理部'), n('12008.00'), nul],
]

const done: TabExecution = {
  status: 'succeeded',
  columns: [],
  rows: [],
  exhausted: true,
  elapsedMs: 12,
  affectedRows: null,
  isStatement: false,
  error: null,
  loadingMore: false,
  progress: null,
}

const plan = [
  'Plan hash value: 1445457117',
  '',
  '---------------------------------------------------------------------------------',
  '| Id  | Operation         | Name      | Rows  | Bytes | Cost (%CPU)| Time     |',
  '---------------------------------------------------------------------------------',
  '|   0 | SELECT STATEMENT  |           |   107 |  2568 |     3   (0)| 00:00:01 |',
  '|   1 |  TABLE ACCESS FULL| EMPLOYEES |   107 |  2568 |     3   (0)| 00:00:01 |',
  '---------------------------------------------------------------------------------',
].join('\n')

useExecutionStore.setState({
  byTab: {
    query: { ...done, columns, rows },
    running: { ...done, status: 'running', elapsedMs: null, progress: { index: 3, total: 8 } },
    failed: {
      ...done,
      status: 'failed',
      elapsedMs: 4,
      error: 'ORA-00942: 表またはビューが存在しません。',
    },
    ddl: { ...done, isStatement: true, elapsedMs: 8 },
    dml: { ...done, isStatement: true, affectedRows: 3, elapsedMs: 21 },
    discarded: { ...done, status: 'discarded' },
  },
  // 実行計画を取ったタブでは、タブ行（結果 / 実行計画）が現れる。
  planByTab: { query: { status: 'succeeded', mode: 'estimate', text: plan, error: null } },
  log: [],
})
useUiStore.setState({ resultTab: 'result' })

const noop = () => {}

const Frame = ({ tabId }: { tabId: string }) => (
  <div
    style={{
      width: 720,
      height: 260,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
    }}
  >
    <ResultPane
      tabId={tabId}
      runningLabel="HR（開発） · 無題-1.sql"
      onCancel={noop}
      onRequestMore={noop}
    />
  </div>
)

/** 問い合わせの結果。実行計画も取ったため「結果」「実行計画」のタブ行が出る。右端は行数と所要時間。 */
export const QueryResult = () => <Frame tabId="query" />

/** スクリプト実行（`⌥⌘⏎`）の最中。何文目を投げているかと「中止」が出る。 */
export const ScriptRunning = () => <Frame tabId="running" />

/** 失敗。メッセージタブが現れ、赤い点が付く。本文には要点だけを出す。 */
export const Failed = () => <Frame tabId="failed" />

/** DDL は行数を持たないため「0 行」とは言わず「完了しました」と出す。 */
export const DdlCompleted = () => <Frame tabId="ddl" />

/** DML は影響した行数を出す。 */
export const DmlAffectedRows = () => <Frame tabId="dml" />

/** 別のタブで実行したため、この結果セットが閉じられたとき。 */
export const Discarded = () => <Frame tabId="discarded" />
