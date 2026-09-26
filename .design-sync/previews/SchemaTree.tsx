import { useEffect, useRef } from 'react'
import { SchemaTree, useSchemaStore } from 'koduchi-ui'
import type { SchemaNode, TableColumn } from 'koduchi-ui'

const schemas: SchemaNode[] = [
  {
    name: 'HR',
    objectCount: 34,
    objects: [
      { name: 'COUNTRIES', kind: 'table' },
      { name: 'DEPARTMENTS', kind: 'table' },
      { name: 'EMPLOYEES', kind: 'table' },
      { name: 'JOBS', kind: 'table' },
      { name: 'JOB_HISTORY', kind: 'table' },
      { name: 'LOCATIONS', kind: 'table' },
      { name: 'REGIONS', kind: 'table' },
      { name: 'EMP_DETAILS_VIEW', kind: 'view' },
      { name: 'EMP_EMAIL_UK', kind: 'index' },
      { name: 'EMP_DEPARTMENT_IX', kind: 'index' },
      { name: 'UPDATE_JOB_HISTORY', kind: 'trigger' },
      { name: 'EMPLOYEES_SEQ', kind: 'sequence' },
      { name: 'DEPARTMENTS_SEQ', kind: 'sequence' },
      { name: 'ADD_JOB_HISTORY', kind: 'procedure' },
      { name: 'SECURE_DML', kind: 'procedure' },
      { name: 'PKG_PAYROLL', kind: 'package' },
    ],
  },
  { name: 'KODUCHI', objectCount: 12, objects: [{ name: 'SAMPLE_ORDERS', kind: 'table' }] },
  { name: 'OE', objectCount: 28, objects: [{ name: 'ORDERS', kind: 'table' }] },
  { name: 'SH', objectCount: 41, objects: [{ name: 'SALES', kind: 'table' }] },
]

const col = (
  name: string,
  typeName: string,
  nullable: boolean,
  kind: TableColumn['kind'],
): TableColumn => ({
  objectName: 'EMPLOYEES',
  name,
  typeName,
  nullable,
  kind,
})

const columns: Record<string, TableColumn[]> = {
  HR: [
    col('EMPLOYEE_ID', 'NUMBER(6)', false, 'number'),
    col('FIRST_NAME', 'VARCHAR2(20)', true, 'text'),
    col('LAST_NAME', 'VARCHAR2(25)', false, 'text'),
    col('EMAIL', 'VARCHAR2(25)', false, 'text'),
    col('HIRE_DATE', 'DATE', false, 'datetime'),
    col('JOB_ID', 'VARCHAR2(10)', false, 'text'),
    col('SALARY', 'NUMBER(8,2)', true, 'number'),
    col('DEPARTMENT_ID', 'NUMBER(4)', true, 'number'),
  ],
}

useSchemaStore.setState({
  schemas,
  columns,
  status: 'ready',
  columnStatus: 'ready',
  loadedSchemas: 4,
  search: '',
  expanded: { HR: true, 'HR.#table': true, 'HR.EMPLOYEES': true },
  error: null,
})

const handlers = { onInsert: () => {}, onOpenSelect: () => {}, onOpenDefinition: () => {} }

const ExpandedTree = () => (
  <div style={{ width: 280, height: 660, background: 'var(--panel)' }}>
    <SchemaTree {...handlers} />
  </div>
)

// 右クリックは部品の内側の状態なので、行が描かれるのを待って contextmenu を送る。
// 器に transform を付けてあり、fixed のメニューの座標は器の左上から数える。
const WithMenu = () => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    const tryOpen = () => {
      const root = ref.current
      if (!root) return
      if (root.querySelector('[role="menu"]')) return
      const row = Array.from(root.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('EMPLOYEES'),
      )
      if (!row) {
        timer = window.setTimeout(tryOpen, 50)
        return
      }
      const box = root.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: r.left - box.left + 90,
          clientY: r.bottom - box.top + 2,
        }),
      )
    }
    tryOpen()
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div
      ref={ref}
      style={{ width: 280, height: 660, transform: 'translateZ(0)', background: 'var(--panel)' }}
    >
      <SchemaTree {...handlers} />
    </div>
  )
}

/** HR を開き、テーブルの束と EMPLOYEES の列まで広げたところ。下に他の種別の束と他のスキーマが続く。 */
export const Expanded = () => <ExpandedTree />

/** EMPLOYEES を右クリックしたところ。4 項目のメニューが出る。 */
export const ContextMenuOpen = () => <WithMenu />
