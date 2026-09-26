import { TableDefinitionPanel, useDefinitionStore } from 'koduchi-ui'
import type { ObjectDefinition, TableColumn } from 'koduchi-ui'

// 定義はストアの `byTab` にタブ ID ごとに入る。見本ごとに別のタブ ID を渡し、
// 1 つのストアのまま内訳（列 / 制約 / 索引 / DDL）違いを並べる。

const col = (
  name: string,
  typeName: string,
  nullable: boolean,
  kind: TableColumn['kind'],
  comment?: string,
): TableColumn => ({
  objectName: 'EMPLOYEES',
  name,
  typeName,
  nullable,
  kind,
  comment,
})

const definition: ObjectDefinition = {
  owner: 'HR',
  name: 'EMPLOYEES',
  kind: 'table',
  comment: '従業員の台帳。退職者も論理削除せずに残す。部署の異動は JOB_HISTORY に記録する。',
  columns: [
    col('EMPLOYEE_ID', 'NUMBER(6)', false, 'number', '従業員番号'),
    col('FIRST_NAME', 'VARCHAR2(20)', true, 'text', '名'),
    col('LAST_NAME', 'VARCHAR2(25)', false, 'text', '姓'),
    col('EMAIL', 'VARCHAR2(25)', false, 'text', '社内メールのアカウント名'),
    col('PHONE_NUMBER', 'VARCHAR2(20)', true, 'text'),
    col('HIRE_DATE', 'DATE', false, 'datetime', '入社日'),
    col('JOB_ID', 'VARCHAR2(10)', false, 'text', '職種'),
    col('SALARY', 'NUMBER(8,2)', true, 'number', '月給'),
    col('COMMISSION_PCT', 'NUMBER(2,2)', true, 'number', '歩合率（営業部のみ）'),
    col('MANAGER_ID', 'NUMBER(6)', true, 'number', '上長の従業員番号'),
    col('DEPARTMENT_ID', 'NUMBER(4)', true, 'number', '所属部署'),
  ],
  constraints: [
    {
      name: 'EMP_EMP_ID_PK',
      kind: 'primaryKey',
      columns: ['EMPLOYEE_ID'],
      searchCondition: null,
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
      deleteRule: null,
      enabled: true,
    },
    {
      name: 'EMP_EMAIL_UK',
      kind: 'unique',
      columns: ['EMAIL'],
      searchCondition: null,
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
      deleteRule: null,
      enabled: true,
    },
    {
      name: 'EMP_DEPT_FK',
      kind: 'foreignKey',
      columns: ['DEPARTMENT_ID'],
      searchCondition: null,
      referencedOwner: 'HR',
      referencedTable: 'DEPARTMENTS',
      referencedColumns: ['DEPARTMENT_ID'],
      deleteRule: 'NO ACTION',
      enabled: true,
    },
    {
      name: 'EMP_MANAGER_FK',
      kind: 'foreignKey',
      columns: ['MANAGER_ID'],
      searchCondition: null,
      referencedOwner: 'HR',
      referencedTable: 'EMPLOYEES',
      referencedColumns: ['EMPLOYEE_ID'],
      deleteRule: 'SET NULL',
      enabled: true,
    },
    {
      name: 'EMP_SALARY_MIN',
      kind: 'check',
      columns: ['SALARY'],
      searchCondition: 'salary > 0',
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
      deleteRule: null,
      enabled: false,
    },
  ],
  indexes: [
    {
      name: 'EMP_EMP_ID_PK',
      owner: 'HR',
      unique: true,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: false,
      columns: [{ name: 'EMPLOYEE_ID', descending: false }],
    },
    {
      name: 'EMP_EMAIL_UK',
      owner: 'HR',
      unique: true,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: false,
      columns: [{ name: 'EMAIL', descending: false }],
    },
    {
      name: 'EMP_DEPARTMENT_IX',
      owner: 'HR',
      unique: false,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: false,
      columns: [{ name: 'DEPARTMENT_ID', descending: false }],
    },
    {
      name: 'EMP_NAME_IX',
      owner: 'HR',
      unique: false,
      indexType: 'NORMAL',
      status: 'UNUSABLE',
      generated: false,
      columns: [
        { name: 'LAST_NAME', descending: false },
        { name: 'FIRST_NAME', descending: false },
      ],
    },
    {
      name: 'SYS_C008172',
      owner: 'HR',
      unique: true,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: true,
      columns: [{ name: 'EMPLOYEE_ID', descending: false }],
    },
  ],
}

const ddl = `CREATE TABLE "HR"."EMPLOYEES"
   (	"EMPLOYEE_ID" NUMBER(6,0),
	"FIRST_NAME" VARCHAR2(20),
	"LAST_NAME" VARCHAR2(25) CONSTRAINT "EMP_LAST_NAME_NN" NOT NULL ENABLE,
	"EMAIL" VARCHAR2(25) CONSTRAINT "EMP_EMAIL_NN" NOT NULL ENABLE,
	"HIRE_DATE" DATE CONSTRAINT "EMP_HIRE_DATE_NN" NOT NULL ENABLE,
	"SALARY" NUMBER(8,2),
	"DEPARTMENT_ID" NUMBER(4,0),
	 CONSTRAINT "EMP_EMP_ID_PK" PRIMARY KEY ("EMPLOYEE_ID") ENABLE,
	 CONSTRAINT "EMP_DEPT_FK" FOREIGN KEY ("DEPARTMENT_ID")
	  REFERENCES "HR"."DEPARTMENTS" ("DEPARTMENT_ID") ENABLE
   ) ;`

const target = { owner: 'HR', name: 'EMPLOYEES', kind: 'table' as const }

const entry = {
  target,
  definition,
  status: 'ready' as const,
  error: null,
  permissionDenied: false,
  ddl: null,
  ddlStatus: 'idle' as const,
  ddlError: null,
  ddlPermissionDenied: false,
  search: '',
  tab: 'columns' as const,
}

useDefinitionStore.setState({
  byTab: {
    columns: entry,
    filtered: { ...entry, search: '従業員' },
    constraints: { ...entry, tab: 'constraints' },
    indexes: { ...entry, tab: 'indexes' },
    ddl: {
      ...entry,
      tab: 'ddl',
      ddlStatus: 'ready',
      ddl: {
        owner: 'HR',
        name: 'EMPLOYEES',
        kind: 'table',
        parts: [{ label: 'テーブル', sql: ddl }],
      },
    },
    denied: {
      ...entry,
      definition: null,
      status: 'failed',
      permissionDenied: true,
      error: 'ORA-01031: 権限が不足しています。',
    },
  },
})

const Frame = ({ tabId }: { tabId: string }) => (
  <div
    style={{
      width: 760,
      height: 460,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
    }}
  >
    <TableDefinitionPanel connectionId="preview-1" tabId={tabId} />
  </div>
)

/** 列の内訳。表のコメントは見出しの下に、列のコメントは 5 つめの欄に出る。 */
export const Columns = () => <Frame tabId="columns" />

/** 絞り込み中。列はコメント（論理名）でも引け、コピーのボタンが「絞り込んだぶんをコピー」に変わる。 */
export const FilteredByComment = () => <Frame tabId="filtered" />

/** 制約の内訳。外部キーは参照先の表と列まで出す。 */
export const Constraints = () => <Frame tabId="constraints" />

/** 索引の内訳。自動生成の索引も出し、使えない索引には状態を添える。 */
export const Indexes = () => <Frame tabId="indexes" />

/** DDL の内訳。`GET_DDL` の出力をそのまま等幅で出す。 */
export const Ddl = () => <Frame tabId="ddl" />

/** 辞書ビューを読む権限が無いとき。空の定義ではなく理由を出す。 */
export const PermissionDenied = () => <Frame tabId="denied" />
