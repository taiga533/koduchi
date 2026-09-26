import { Sidebar, useSchemaStore, useUiStore } from 'koduchi-ui'
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
      { name: 'UPDATE_JOB_HISTORY', kind: 'trigger' },
      { name: 'EMPLOYEES_SEQ', kind: 'sequence' },
      { name: 'ADD_JOB_HISTORY', kind: 'procedure' },
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
  objectName: 'DEPARTMENTS',
  name,
  typeName,
  nullable,
  kind,
})

// 段階 2 の途中（4 スキーマ中 2 つ読み終えた）を置き、下端の進捗を見せる。
useSchemaStore.setState({
  schemas,
  columns: {
    HR: [
      col('DEPARTMENT_ID', 'NUMBER(4)', false, 'number'),
      col('DEPARTMENT_NAME', 'VARCHAR2(30)', false, 'text'),
      col('MANAGER_ID', 'NUMBER(6)', true, 'number'),
      col('LOCATION_ID', 'NUMBER(4)', true, 'number'),
    ],
  },
  status: 'ready',
  columnStatus: 'loading',
  loadedSchemas: 2,
  search: '',
  expanded: { HR: true, 'HR.#table': true, 'HR.DEPARTMENTS': true },
  error: null,
})
useUiStore.setState({ sidebarSegment: 'schema' })

const noop = () => {}

const props = {
  savedConnectionId: 'saved-hr',
  connectionName: 'HR（開発）',
  onOpenNewConnection: noop,
  onUseHistory: noop,
  onInsertIdentifier: noop,
  onOpenSelect: noop,
  width: 272,
}

/** 繋がっている接続のスキーマ。列情報を読み込み中で、下端に進捗が出る。 */
export const Connected = () => (
  <div style={{ width: 288, height: 560, display: 'flex', padding: 8, background: 'var(--bg)' }}>
    <Sidebar connectionId="preview-1" onOpenDefinition={noop} {...props} />
  </div>
)

/** 未接続。再読み込みと絞り込みのボタンが押せなくなる。 */
export const Disconnected = () => (
  <div style={{ width: 288, height: 560, display: 'flex', padding: 8, background: 'var(--bg)' }}>
    <Sidebar connectionId={null} onOpenDefinition={null} {...props} />
  </div>
)
