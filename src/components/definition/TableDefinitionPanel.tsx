/**
 * テーブル定義ビュー（ADR 0019・0022）。
 *
 * スキーマツリーの右クリックメニューから**エディタのタブ帯に定義タブとして**
 * 開く（ADR 0022）。列・制約・索引・DDL の 4 つの内訳を 1 枚に収めてある。
 * 定義タブを選んでいる間はエディタも結果ペインも出さず、本体の領域をまるごと
 * ここが使う。オーバーレイに出す作り（ADR 0019）は 0022 で覆した。
 *
 * 絞り込みは 4 つの内訳のうち列・制約・索引に効く。列が数百ある表は珍しくない
 * ため、開いてからスクロールで探させるのでは用を成さない。
 *
 * DDL は DDL の内訳を開いたときに初めて取る（ADR 0019）。
 * `DBMS_METADATA.GET_DDL` の権限が無いというだけで、列も制約も索引も
 * 見られなくなってはいけない。
 */

import { useMemo } from 'react'
import { Search } from 'lucide-react'
import {
  DEFINITION_TABS,
  DEFINITION_TAB_LABELS,
  selectDefinition,
  useDefinitionStore,
  type DefinitionTab,
} from '../../stores/definition'
import type { ObjectDefinition, TableColumn, TableConstraint, TableIndex } from '../../types/db'
import { CONSTRAINT_KIND_LABELS, OBJECT_KIND_LABELS } from '../../types/db'
import {
  filterColumns,
  filterConstraints,
  filterIndexes,
  formatIndexColumns,
  formatReference,
} from './definitionSearch'

interface TableDefinitionPanelProps {
  /** 接続の識別子。DDL の内訳を開いたときの取得に使う。 */
  connectionId: string
  /** どの定義タブを描くか（ADR 0022）。 */
  tabId: string
}

export function TableDefinitionPanel({ connectionId, tabId }: TableDefinitionPanelProps) {
  const entry = useDefinitionStore((state) => selectDefinition(state, tabId))
  const setSearch = useDefinitionStore((state) => state.setSearch)
  const selectTab = useDefinitionStore((state) => state.selectTab)

  if (entry === null) {
    return null
  }

  const { target, definition, status, error, permissionDenied, search, tab } = entry

  return (
    <section
      data-testid="table-definition"
      aria-label="テーブル定義"
      className="flex-1 min-h-0 overflow-hidden bg-panel rounded-10px border border-line p-18px flex flex-col gap-12px"
    >
      <div className="flex items-center gap-10px">
        <h2 className="text-14px font-600 text-fg m-0 truncate">
          {target.owner}.{target.name}
        </h2>
        <span className="text-10.5px text-fg5 shrink-0">{OBJECT_KIND_LABELS[target.kind]}</span>
      </div>

      <div className="flex items-center gap-2px" role="tablist" aria-label="定義の内訳">
        {DEFINITION_TABS.map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={tab === each}
            onClick={() => selectTab(connectionId, tabId, each)}
            className={`px-11px py-5px rounded-7px border-none text-11.5px cursor-pointer font-inherit ${
              tab === each ? 'bg-fill text-fg' : 'bg-transparent text-fg4'
            }`}
          >
            {DEFINITION_TAB_LABELS[each]}
            {each !== 'ddl' ? (
              <span className="ml-6px text-10.5px text-fg5">{数える(definition, each)}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'ddl' ? null : (
        <div className="flex items-center gap-8px px-9px py-4px rounded-7px bg-fill">
          <Search size={14} className="text-fg5 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(tabId, event.target.value)}
            placeholder="列名・制約名・索引名で絞り込む"
            aria-label="定義を絞り込む"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-12px text-fg font-inherit placeholder:text-fg4"
          />
        </div>
      )}

      <PanelBody
        tabId={tabId}
        status={status}
        error={error}
        permissionDenied={permissionDenied}
        definition={definition}
        tab={tab}
        search={search}
      />
    </section>
  )
}

/**
 * タブの見出しに添える件数。
 *
 * 絞り込む前の総数を出す。絞り込んだ数を出すと、語を打つたびに見出しが
 * 動いて「元は何件あったのか」が分からなくなる。
 *
 * @param definition 取得した定義。未取得なら `null`
 * @param tab 対象のタブ
 */
function 数える(definition: ObjectDefinition | null, tab: DefinitionTab): number {
  if (definition === null) {
    return 0
  }

  switch (tab) {
    case 'columns':
      return definition.columns.length
    case 'constraints':
      return definition.constraints.length
    case 'indexes':
      return definition.indexes.length
    default:
      return 0
  }
}

interface PanelBodyProps {
  /** どの定義タブを描くか。DDL の内訳がストアを引くのに要る。 */
  tabId: string
  status: string
  error: string | null
  permissionDenied: boolean
  definition: ObjectDefinition | null
  tab: DefinitionTab
  search: string
}

/** パネルの本文。権限不足・失敗・読み込み中・タブの中身を出し分ける。 */
function PanelBody({
  tabId,
  status,
  error,
  permissionDenied,
  definition,
  tab,
  search,
}: PanelBodyProps) {
  if (permissionDenied) {
    return (
      <Centered>
        <p className="text-13px text-fg m-0">この接続ではこのオブジェクトの定義を見られません</p>
        <p className="text-11.5px text-fg4 m-0 text-center leading-[1.6] max-w-560px break-words">
          {error}
        </p>
      </Centered>
    )
  }

  if (status === 'failed') {
    return (
      <Centered>
        <p className="text-12px text-err text-center m-0 max-w-560px break-words">{error}</p>
      </Centered>
    )
  }

  if (status === 'loading' || definition === null) {
    return (
      <div className="flex-1 flex items-center justify-center py-32px text-12.5px text-fg4">
        定義を読み込んでいます…
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {tab === 'columns' ? <ColumnTable columns={definition.columns} search={search} /> : null}
      {tab === 'constraints' ? (
        <ConstraintTable constraints={definition.constraints} search={search} />
      ) : null}
      {tab === 'indexes' ? <IndexTable indexes={definition.indexes} search={search} /> : null}
      {tab === 'ddl' ? <DdlView tabId={tabId} /> : null}
    </div>
  )
}

/** 列の一覧。 */
function ColumnTable({ columns, search }: { columns: TableColumn[]; search: string }) {
  const 絞り込み済み = useMemo(() => filterColumns(columns, search), [columns, search])

  if (絞り込み済み.length === 0) {
    return <Empty>{columns.length === 0 ? '列がありません' : '当てはまる列がありません'}</Empty>
  }

  return (
    <table className="w-full border-collapse text-11.5px">
      <thead>
        <tr className="text-fg4 text-left">
          <th className="font-500 py-5px pr-8px w-40px">#</th>
          <th className="font-500 py-5px pr-8px">列</th>
          <th className="font-500 py-5px pr-8px">型</th>
          <th className="font-500 py-5px">NULL</th>
        </tr>
      </thead>
      <tbody>
        {絞り込み済み.map((column) => (
          <tr key={column.name} className="border-t border-line2 text-fg2">
            <td className="py-6px pr-8px text-fg5 tabular-nums">{columns.indexOf(column) + 1}</td>
            <td className="py-6px pr-8px break-all">{column.name}</td>
            <td className="py-6px pr-8px whitespace-nowrap text-fg3">{column.typeName}</td>
            <td className="py-6px whitespace-nowrap text-fg4">
              {column.nullable ? '可' : 'NOT NULL'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 制約の一覧（ADR 0019）。
 *
 * 外部キーは参照先の表と列まで出す。「この列はどこを指しているのか」を
 * 突き止めるのが、定義を見にくる主な理由の 1 つだからである。
 */
function ConstraintTable({
  constraints,
  search,
}: {
  constraints: TableConstraint[]
  search: string
}) {
  const 絞り込み済み = useMemo(() => filterConstraints(constraints, search), [constraints, search])

  if (絞り込み済み.length === 0) {
    return (
      <Empty>{constraints.length === 0 ? '制約がありません' : '当てはまる制約がありません'}</Empty>
    )
  }

  return (
    <table className="w-full border-collapse text-11.5px">
      <thead>
        <tr className="text-fg4 text-left">
          <th className="font-500 py-5px pr-8px">種別</th>
          <th className="font-500 py-5px pr-8px">名前</th>
          <th className="font-500 py-5px pr-8px">列</th>
          <th className="font-500 py-5px">参照先 / 条件</th>
        </tr>
      </thead>
      <tbody>
        {絞り込み済み.map((constraint) => (
          <tr key={constraint.name} className="border-t border-line2 text-fg2 align-top">
            <td className="py-6px pr-8px whitespace-nowrap">
              {CONSTRAINT_KIND_LABELS[constraint.kind]}
              {constraint.enabled ? null : (
                <span className="ml-6px text-10.5px text-warn">無効</span>
              )}
            </td>
            <td className="py-6px pr-8px break-all text-fg3">{constraint.name}</td>
            <td className="py-6px pr-8px break-all">{constraint.columns.join(', ') || '—'}</td>
            <td className="py-6px break-all text-fg3">
              <ConstraintDetail constraint={constraint} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 制約の右端の欄。外部キーは参照先、検査制約は条件を出す。 */
function ConstraintDetail({ constraint }: { constraint: TableConstraint }) {
  if (constraint.kind === 'foreignKey') {
    const 参照先 = formatReference(constraint)
    if (参照先 === null) {
      // 参照先が見えないのは権限の話である。括弧だけを出して黙らない。
      return <span className="text-fg5">参照先を参照できません</span>
    }
    return (
      <span>
        → {参照先}
        {constraint.deleteRule && constraint.deleteRule !== 'NO ACTION' ? (
          <span className="ml-6px text-10.5px text-fg5">ON DELETE {constraint.deleteRule}</span>
        ) : null}
      </span>
    )
  }

  if (constraint.kind === 'check') {
    return <span>{constraint.searchCondition ?? '—'}</span>
  }

  return <span className="text-fg5">—</span>
}

/**
 * 索引の一覧（ADR 0019）。
 *
 * 自動生成された索引にも印を付けて並べる。主キーの索引が見えないと
 * 「この列で引けるのか」が分からないためである（ツリーの扱いとは違う）。
 */
function IndexTable({ indexes, search }: { indexes: TableIndex[]; search: string }) {
  const 絞り込み済み = useMemo(() => filterIndexes(indexes, search), [indexes, search])

  if (絞り込み済み.length === 0) {
    return <Empty>{indexes.length === 0 ? '索引がありません' : '当てはまる索引がありません'}</Empty>
  }

  return (
    <table className="w-full border-collapse text-11.5px">
      <thead>
        <tr className="text-fg4 text-left">
          <th className="font-500 py-5px pr-8px">名前</th>
          <th className="font-500 py-5px pr-8px">列</th>
          <th className="font-500 py-5px pr-8px">一意</th>
          <th className="font-500 py-5px">種類</th>
        </tr>
      </thead>
      <tbody>
        {絞り込み済み.map((index) => (
          <tr key={`${index.owner}.${index.name}`} className="border-t border-line2 text-fg2">
            <td className="py-6px pr-8px break-all">
              {index.name}
              {index.generated ? (
                <span
                  className="ml-6px text-10.5px text-fg5"
                  title="制約のために自動生成された索引"
                >
                  自動生成
                </span>
              ) : null}
            </td>
            <td className="py-6px pr-8px break-all text-fg3">{formatIndexColumns(index) || '—'}</td>
            <td className="py-6px pr-8px whitespace-nowrap text-fg4">
              {index.unique ? 'UNIQUE' : '—'}
            </td>
            <td className="py-6px whitespace-nowrap text-fg4">
              {index.indexType}
              {index.status && index.status !== 'VALID' ? (
                <span className="ml-6px text-10.5px text-warn">{index.status}</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * DDL の内訳（ADR 0019）。
 *
 * `DBMS_METADATA.GET_DDL` の結果をそのまま等幅で出す。パッケージは仕様と本体の
 * 2 つが並ぶ。権限が無いことを「定義が空」と混同させない。
 */
function DdlView({ tabId }: { tabId: string }) {
  const entry = useDefinitionStore((state) => selectDefinition(state, tabId))
  const ddl = entry?.ddl ?? null
  const ddlStatus = entry?.ddlStatus ?? 'idle'
  const ddlError = entry?.ddlError ?? null
  const ddlPermissionDenied = entry?.ddlPermissionDenied ?? false

  if (ddlPermissionDenied) {
    return (
      <Centered>
        <p className="text-13px text-fg m-0">この接続では DDL を取得できません</p>
        <p className="text-11.5px text-fg4 m-0 text-center leading-[1.6] max-w-560px break-words">
          {ddlError}
        </p>
      </Centered>
    )
  }

  if (ddlStatus === 'failed') {
    return (
      <Centered>
        <p className="text-12px text-err text-center m-0 max-w-560px break-words">{ddlError}</p>
      </Centered>
    )
  }

  if (ddlStatus !== 'ready' || ddl === null) {
    return (
      <div className="flex-1 flex items-center justify-center py-32px text-12.5px text-fg4">
        DDL を読み込んでいます…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-12px">
      {ddl.parts.map((part) => (
        <section key={part.label} className="flex flex-col gap-5px">
          {ddl.parts.length > 1 ? (
            <h3 className="m-0 text-11.5px font-500 text-fg4">{part.label}</h3>
          ) : null}
          <pre className="m-0 p-11px rounded-8px bg-fill text-11.5px text-fg2 leading-[1.6] whitespace-pre-wrap break-all">
            {part.sql}
          </pre>
        </section>
      ))}
    </div>
  )
}

/** 中央に寄せた案内。 */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px py-32px">
      {children}
    </div>
  )
}

/** 表の代わりに出す 1 行の説明。 */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 py-32px text-center text-12.5px text-fg4">{children}</p>
}
