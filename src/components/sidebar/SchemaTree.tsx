/**
 * スキーマツリー（ADR 0007）。
 *
 * スキーマ行の右にオブジェクト数を出し、展開するとオブジェクトが並ぶ。
 * テーブルとビューはさらに展開でき、読み込み済みの列が型付きで並ぶ。
 *
 * テーブル定義ビューは器のみで開かない（ADR の機能スコープ）。
 */

import { useMemo } from 'react'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Eye,
  Hash,
  Layers,
  PlayCircle,
  Sigma,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import type { ObjectKind, SchemaNode, TableColumn } from '../../types/db'
import { filterSchemas, nodeKey, useSchemaStore } from '../../stores/schema'

/** オブジェクトの種類ごとの目印。 */
const KIND_ICONS: Record<ObjectKind, LucideIcon> = {
  table: Table2,
  view: Eye,
  materializedView: Layers,
  function: Sigma,
  procedure: PlayCircle,
  package: Boxes,
  sequence: Hash,
}

/** 列を持ちうる種類。展開して列を出せるのはこれだけである。 */
const EXPANDABLE: ObjectKind[] = ['table', 'view', 'materializedView']

export function SchemaTree() {
  const allSchemas = useSchemaStore((state) => state.schemas)
  const columns = useSchemaStore((state) => state.columns)
  const search = useSchemaStore((state) => state.search)
  const expanded = useSchemaStore((state) => state.expanded)
  const toggle = useSchemaStore((state) => state.toggle)
  const status = useSchemaStore((state) => state.status)
  const error = useSchemaStore((state) => state.error)

  // 絞り込みは毎回新しい配列を作るため、ここで記憶しておく。
  const schemas = useMemo(
    () => filterSchemas(allSchemas, columns, search),
    [allSchemas, columns, search],
  )

  if (status === 'loading' && schemas.length === 0) {
    return <Notice>スキーマを読み込んでいます…</Notice>
  }

  if (status === 'failed') {
    return <Notice tone="error">{error ?? 'スキーマを取得できませんでした'}</Notice>
  }

  if (schemas.length === 0) {
    return <Notice>表示できるスキーマがありません</Notice>
  }

  return (
    <ul className="list-none m-0 p-0 flex flex-col">
      {schemas.map((schema) => (
        <SchemaRow
          key={schema.name}
          schema={schema}
          columns={columns[schema.name] ?? []}
          expanded={expanded}
          onToggle={toggle}
        />
      ))}
    </ul>
  )
}

interface SchemaRowProps {
  schema: SchemaNode
  columns: TableColumn[]
  expanded: Record<string, boolean>
  onToggle: (key: string) => void
}

/** スキーマ 1 行と、展開したときのオブジェクト。 */
function SchemaRow({ schema, columns, expanded, onToggle }: SchemaRowProps) {
  const key = nodeKey(schema.name)
  const open = expanded[key] ?? false

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(key)}
        aria-expanded={open}
        className="w-full flex items-center gap-7px px-10px py-5px bg-transparent border-none cursor-pointer font-inherit text-left text-12px text-fg hover:bg-fill"
      >
        {open ? (
          <ChevronDown size={13} className="text-fg5 shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-fg5 shrink-0" />
        )}
        <span className="flex-1 truncate">{schema.name}</span>
        <span className="text-10.5px text-fg5">{schema.objectCount}</span>
      </button>

      {open ? (
        <ul className="list-none m-0 p-0">
          {schema.objects.map((object) => (
            <ObjectRow
              key={object.name}
              schemaName={schema.name}
              name={object.name}
              kind={object.kind}
              columns={columns.filter((column) => column.objectName === object.name)}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

interface ObjectRowProps {
  schemaName: string
  name: string
  kind: ObjectKind
  columns: TableColumn[]
  expanded: Record<string, boolean>
  onToggle: (key: string) => void
}

/** オブジェクト 1 行と、展開したときの列。 */
function ObjectRow({ schemaName, name, kind, columns, expanded, onToggle }: ObjectRowProps) {
  const key = nodeKey(schemaName, name)
  const open = expanded[key] ?? false
  const expandable = EXPANDABLE.includes(kind)
  const Icon = KIND_ICONS[kind]

  return (
    <li>
      <button
        type="button"
        onClick={() => (expandable ? onToggle(key) : undefined)}
        aria-expanded={expandable ? open : undefined}
        className="w-full flex items-center gap-6px pl-22px pr-10px py-4px bg-transparent border-none cursor-pointer font-inherit text-left text-11.5px text-fg2 hover:bg-fill"
      >
        <span className="w-13px shrink-0 flex items-center">
          {expandable ? (
            open ? (
              <ChevronDown size={12} className="text-fg5" />
            ) : (
              <ChevronRight size={12} className="text-fg5" />
            )
          ) : null}
        </span>
        <Icon size={13} className="text-fg5 shrink-0" />
        <span className="flex-1 truncate">{name}</span>
        {expandable ? (
          // テーブル定義ビューは器だけで、開かない（ADR の機能スコープ）。
          <span
            aria-disabled="true"
            title="テーブル定義ビューは未実装です"
            className="shrink-0 text-10px text-fg5 opacity-50"
          >
            定義
          </span>
        ) : null}
      </button>

      {open ? (
        <ul className="list-none m-0 p-0">
          {columns.length === 0 ? (
            <li className="pl-48px pr-10px py-3px text-11px text-fg5">列情報を読み込み中…</li>
          ) : (
            columns.map((column) => (
              <li
                key={column.name}
                className="flex items-center gap-8px pl-48px pr-10px py-3px text-11px"
              >
                <span className="flex-1 truncate text-fg3">{column.name}</span>
                <span className="text-10.5px text-fg5 shrink-0">{column.typeName}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  )
}

/** ツリーの代わりに出す 1 行の説明。 */
function Notice({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <p
      className={`m-0 px-14px py-16px text-12px leading-[1.6] text-center ${
        tone === 'error' ? 'text-err' : 'text-fg5'
      }`}
    >
      {children}
    </p>
  )
}
