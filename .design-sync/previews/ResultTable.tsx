import { ResultTable } from 'koduchi-ui'
import type { Cell, Column, TabExecution } from 'koduchi-ui'

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
  [n('104'), t('Ernst'), t('情報システム部'), n('6000.00'), nul],
  [n('145'), t('Russell'), t('営業部'), n('14000.00'), n('0.40')],
  [n('146'), t('Partners'), t('営業部'), n('13500.00'), n('0.30')],
  [n('147'), t('Errazuriz'), t('営業部'), n('12000.00'), n('0.30')],
  [n('108'), t('Greenberg'), t('経理部'), n('12008.00'), nul],
  [n('109'), t('Faviet'), t('経理部'), n('9000.00'), nul],
]

const execution: TabExecution = {
  status: 'succeeded',
  columns,
  rows,
  exhausted: true,
  elapsedMs: 12,
  affectedRows: null,
  isStatement: false,
  error: null,
  loadingMore: false,
  progress: null,
}

const kindColumns: Column[] = [
  { name: 'ID', typeName: 'NUMBER', kind: 'number' },
  { name: 'NOTE', typeName: 'CLOB', kind: 'text' },
  { name: 'UPDATED_AT', typeName: 'TIMESTAMP(6)', kind: 'datetime' },
  { name: 'ACTIVE', typeName: 'BOOLEAN', kind: 'bool' },
  { name: 'PAYLOAD', typeName: 'RAW(16)', kind: 'binary' },
]

const kindRows: Cell[][] = [
  [
    n('1'),
    t('初回登録'),
    { text: '2026-09-01 09:12:44.120000', kind: 'datetime' },
    { text: 'TRUE', kind: 'bool' },
    { text: '0A1B2C3D4E5F', kind: 'binary' },
  ],
  [
    n('2'),
    t('住所変更のため再登録'),
    { text: '2026-09-14 17:03:02.000000', kind: 'datetime' },
    { text: 'FALSE', kind: 'bool' },
    nul,
  ],
  [n('3'), nul, nul, nul, nul],
]

/** 問い合わせの結果。数値は右寄せ、NULL は淡い `NULL` で出る。 */
export const QueryResult = () => (
  <div
    style={{
      height: 250,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
    }}
  >
    <ResultTable tabId="preview-employees" execution={execution} onRequestMore={() => {}} />
  </div>
)

/** 値の種類ごとの出方（数値・文字列・日時・真偽・バイナリ・NULL）。 */
export const CellKinds = () => (
  <div
    style={{
      height: 160,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
    }}
  >
    <ResultTable
      tabId="preview-kinds"
      execution={{ ...execution, columns: kindColumns, rows: kindRows }}
      onRequestMore={() => {}}
    />
  </div>
)
