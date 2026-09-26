import { useEffect, useRef } from 'react'
import { CommandPalette, createDesignDbApi, setDbApi, useSchemaStore } from 'koduchi-ui'
import type { HistoryEntry, SavedQuery, SchemaNode } from 'koduchi-ui'

const at = (iso: string) => new Date(iso).getTime()

const savedQueries: SavedQuery[] = [
  {
    id: 1,
    name: '部署別の平均給与',
    sql: 'select d.department_name, avg(e.salary)\n  from hr.employees e join hr.departments d using (department_id)\n group by d.department_name',
    connectionName: 'HR（開発）',
    createdAt: at('2026-09-02T10:00:00'),
    updatedAt: at('2026-09-20T09:12:00'),
  },
  {
    id: 2,
    name: '今月の入社者',
    sql: "select * from hr.employees where hire_date >= trunc(sysdate, 'MM')",
    connectionName: 'HR（開発）',
    createdAt: at('2026-09-05T13:00:00'),
    updatedAt: at('2026-09-05T13:00:00'),
  },
  {
    id: 3,
    name: '管理職の一覧',
    sql: 'select * from hr.employees where employee_id in (select manager_id from hr.departments)',
    connectionName: 'HR（本番）',
    createdAt: at('2026-08-11T15:30:00'),
    updatedAt: at('2026-08-11T15:30:00'),
  },
]

const history: HistoryEntry[] = [
  {
    id: 41,
    sql: 'select employee_id, last_name, salary\n  from hr.employees\n where department_id = 60',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-27T10:41:00'),
    elapsedMs: 14,
    rowCount: 5,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 40,
    sql: "update hr.employees set salary = salary * 1.05 where job_id = 'IT_PROG'",
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-27T10:37:00'),
    elapsedMs: 22,
    rowCount: 5,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 39,
    sql: 'select * from hr.job_history order by start_date desc',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-27T10:12:00'),
    elapsedMs: 9,
    rowCount: 10,
    succeeded: true,
    errorMessage: null,
  },
]

// パレットは開いた時点で保存済みクエリと履歴を窓口から読む。描画環境の窓口は
// 決着しないため、この 2 つだけ答えを返す代役へ差し替える。
setDbApi(
  createDesignDbApi({
    listSavedQueries: async () => savedQueries,
    listHistory: async () => history,
  }),
)

const schemas: SchemaNode[] = [
  {
    name: 'HR',
    objectCount: 7,
    objects: [
      { name: 'COUNTRIES', kind: 'table' },
      { name: 'DEPARTMENTS', kind: 'table' },
      { name: 'EMPLOYEES', kind: 'table' },
      { name: 'JOBS', kind: 'table' },
      { name: 'JOB_HISTORY', kind: 'table' },
      { name: 'LOCATIONS', kind: 'table' },
      { name: 'EMP_DETAILS_VIEW', kind: 'view' },
    ],
  },
  {
    name: 'PAYROLL',
    objectCount: 2,
    objects: [
      { name: 'EMPLOYEE_BONUS', kind: 'table' },
      { name: 'PAY_EMPLOYEE_PKG', kind: 'package' },
    ],
  },
]
useSchemaStore.setState({ schemas, status: 'ready' })

const noop = () => {}

const commands = [
  { id: 'run', label: '実行（カーソル位置の文）', shortcut: '⌘⏎', run: noop },
  { id: 'run-selection', label: '選択範囲のみ実行', shortcut: '⇧⌘⏎', run: noop },
  { id: 'run-script', label: 'すべて実行', shortcut: '⌥⌘⏎', run: noop },
  { id: 'explain', label: '実行計画を生成', shortcut: '⌘E', run: noop },
  { id: 'format', label: 'SQL を整形', shortcut: '⇧⌥F', run: noop },
  { id: 'csv', label: '結果を CSV で保存', shortcut: '⌥⌘S', run: noop },
  { id: 'commit', label: 'コミット', shortcut: '⌥⌘C', run: noop },
  { id: 'rollback', label: 'ロールバック', shortcut: '⌥⌘R', run: noop },
  { id: 'sessions', label: 'セッションとロックを開く', shortcut: '', run: noop },
  { id: 'settings', label: '設定を開く', shortcut: '', run: noop },
]

/**
 * 検索語は部品の内側の状態で、props から渡せない。描いた後に入力欄へ打鍵と
 * 同じ `input` を流し、絞り込み中の見た目を出す。
 */
function Typed({ query, children }: { query: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const input = ref.current?.querySelector('input')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, [query])
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}

const frame: React.CSSProperties = {
  position: 'relative',
  width: 720,
  height: 560,
  background: 'var(--panel)',
  transform: 'translateZ(0)',
}

const palette = (
  <CommandPalette
    connectionName="HR（開発）"
    commands={commands}
    onUseSql={noop}
    onRevealSchemaObject={noop}
    onClose={noop}
  />
)

/** 開いた直後。コマンド・スキーマ・保存済みクエリ・履歴が見出し付きで並ぶ。 */
export const Opened = () => <div style={frame}>{palette}</div>

/** 「emp」で絞り込んだところ。表・保存済みクエリ・履歴をまたいで当たる。 */
export const FilteredByTable = () => (
  <div style={frame}>
    <Typed query="emp">{palette}</Typed>
  </div>
)

/** どれにも当たらないとき。 */
export const NoMatch = () => (
  <div style={{ ...frame, height: 320 }}>
    <Typed query="invoice">{palette}</Typed>
  </div>
)
