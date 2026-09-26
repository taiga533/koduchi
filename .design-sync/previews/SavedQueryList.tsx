import { useEffect, useRef } from 'react'
import { SavedQueryList, useSavedQueryStore } from 'koduchi-ui'
import type { SavedQuery } from 'koduchi-ui'

const at = (iso: string) => new Date(iso).getTime()

const entries: SavedQuery[] = [
  {
    id: 7,
    name: '部署別の平均給与',
    sql: 'select d.department_name, round(avg(e.salary)) as avg_salary\n  from hr.employees e join hr.departments d using (department_id)\n group by d.department_name',
    connectionName: 'HR（開発）',
    createdAt: at('2026-09-10T10:00:00+09:00'),
    updatedAt: at('2026-09-20T10:00:00+09:00'),
  },
  {
    id: 6,
    name: '今月の入社者',
    sql: "select employee_id, last_name, hire_date from hr.employees where hire_date >= trunc(sysdate, 'MM')",
    connectionName: 'HR（開発）',
    createdAt: at('2026-09-02T10:00:00+09:00'),
    updatedAt: at('2026-09-02T10:00:00+09:00'),
  },
  {
    id: 5,
    name: 'マネージャーの階層',
    sql: "select level, lpad(' ', level * 2) || last_name as name\n  from hr.employees\n start with manager_id is null\nconnect by prior employee_id = manager_id",
    connectionName: 'HR（本番・参照）',
    createdAt: at('2026-08-21T10:00:00+09:00'),
    updatedAt: at('2026-08-21T10:00:00+09:00'),
  },
  {
    id: 4,
    name: 'ロック待ちのセッション',
    sql: 'select sid, serial#, blocking_session, event from v$session where blocking_session is not null',
    connectionName: 'HR（本番・参照）',
    createdAt: at('2026-08-01T10:00:00+09:00'),
    updatedAt: at('2026-08-01T10:00:00+09:00'),
  },
]

// 保存済みの既定は「全接続」（ADR 0018）。
useSavedQueryStore.setState({ entries, scope: 'all', connectionName: 'HR（開発）', loading: false })

// 名前の付け直しは行の内側の状態なので、描いた後に先頭の鉛筆を押す。
const RenamingList = () => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current?.querySelector('input')) return
    ref.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="このクエリの名前を変える"]')
      ?.click()
  }, [])
  return (
    <div
      ref={ref}
      style={{ width: 280, height: 330, overflow: 'auto', background: 'var(--panel)' }}
    >
      <SavedQueryList onUse={() => {}} />
    </div>
  )
}

/** 全接続の保存済みクエリ。名前・SQL の 1 行目・接続名の 3 段。 */
export const Entries = () => (
  <div style={{ width: 280, height: 330, overflow: 'auto', background: 'var(--panel)' }}>
    <SavedQueryList onUse={() => {}} />
  </div>
)

/** 先頭の名前を付け直している途中。入力欄と確定のチェックに替わる。 */
export const Renaming = () => <RenamingList />
