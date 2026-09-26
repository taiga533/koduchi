import { HistoryList, useHistoryStore } from 'koduchi-ui'
import type { HistoryEntry } from 'koduchi-ui'

const at = (iso: string) => new Date(iso).getTime()

const entries: HistoryEntry[] = [
  {
    id: 42,
    sql: 'select e.employee_id, e.last_name, d.department_name\n  from hr.employees e\n  join hr.departments d on d.department_id = e.department_id',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-26T16:42:00+09:00'),
    elapsedMs: 18,
    rowCount: 107,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 41,
    sql: 'update hr.employees set salary = salary * 1.05 where department_id = 60',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-26T16:31:00+09:00'),
    elapsedMs: 7,
    rowCount: 5,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 40,
    sql: 'select * from hr.employes',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-26T16:30:00+09:00'),
    elapsedMs: 3,
    rowCount: null,
    succeeded: false,
    errorMessage: 'ORA-00942: 表またはビューが存在しません',
  },
  {
    id: 39,
    sql: 'create index hr.emp_hire_date_ix on hr.employees (hire_date)',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-26T15:58:00+09:00'),
    elapsedMs: 41,
    rowCount: null,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 38,
    sql: 'select department_id, count(*), avg(salary)\n  from hr.employees\n group by department_id',
    connectionName: 'HR（開発）',
    startedAt: at('2026-09-25T11:04:00+09:00'),
    elapsedMs: 12,
    rowCount: 12,
    succeeded: true,
    errorMessage: null,
  },
]

useHistoryStore.setState({
  entries,
  scope: 'connection',
  connectionName: 'HR（開発）',
  loading: false,
})

/** 「この接続のみ」の履歴。成功は行数と時間、失敗は赤で「失敗」、DDL は時間だけ。 */
export const Entries = () => (
  <div style={{ width: 280, height: 330, overflow: 'auto', background: 'var(--panel)' }}>
    <HistoryList onUse={() => {}} />
  </div>
)
