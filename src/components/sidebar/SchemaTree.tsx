/**
 * スキーマツリー（ADR 0007・0014）。
 *
 * スキーマ行の右にオブジェクト数を出し、展開すると**種別ごとの束**が並ぶ。
 * 束を開くとその種別のオブジェクトが並び、テーブルとビューはさらに展開できて
 * 読み込み済みの列が型付きで出る。
 *
 * 種別で束ねるのは、索引やシノニムまで載せると 1 スキーマのオブジェクトが
 * 数千行に届くためである。束ねてあれば、スキーマを開いたときに増える行数は
 * 種別の数（高々 12）に収まる（ADR 0014）。
 *
 * 行の右の「定義」からテーブル定義ビューを開く（ADR 0019）。ツリーのマウス
 * 操作の割り振りは足していない。「定義」は行とは別の押しどころであり、行の
 * クリックやダブルクリックの意味を変えないためである。
 *
 * 木のまま描くと、描き直しの手間が中身の量に比例する。Oracle のスキーマは
 * オブジェクトが数千に達することがあり、列の読み込みが進むたびに全体を組み直すと
 * 絞り込みの入力が目に見えて詰まる。そこで一度平らな行の並びに直し、見えている
 * 分だけを描く（結果テーブルと同じ TanStack Virtual）。
 */

import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Eye,
  Hash,
  Layers,
  Link2,
  ListOrdered,
  Network,
  PlayCircle,
  Shapes,
  Sigma,
  Table2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { DefinitionTarget, ObjectKind, SchemaNode, TableColumn } from '../../types/db'
import { OBJECT_KIND_LABELS, OBJECT_KIND_ORDER } from '../../types/db'
import { filterSchemas, kindGroupKey, nodeKey, useSchemaStore } from '../../stores/schema'
import { useDefinitionStore } from '../../stores/definition'

/** オブジェクトの種類ごとの目印。 */
const KIND_ICONS: Record<ObjectKind, LucideIcon> = {
  table: Table2,
  view: Eye,
  materializedView: Layers,
  index: ListOrdered,
  trigger: Zap,
  sequence: Hash,
  synonym: Link2,
  type: Shapes,
  function: Sigma,
  procedure: PlayCircle,
  package: Boxes,
  databaseLink: Network,
}

/** 列を持ちうる種類。展開して列を出せるのはこれだけである。 */
const EXPANDABLE: ObjectKind[] = ['table', 'view', 'materializedView']

/** 平らにした 1 行。仮想スクロールに載せる単位である。 */
export type TreeRow =
  | { kind: 'schema'; key: string; name: string; objectCount: number; open: boolean }
  | { kind: 'kindGroup'; key: string; objectKind: ObjectKind; count: number; open: boolean }
  | {
      kind: 'object'
      key: string
      /** 所有者のスキーマ名。定義ビューを開くのに要る（ADR 0019）。 */
      owner: string
      name: string
      objectKind: ObjectKind
      expandable: boolean
      open: boolean
    }
  | { kind: 'column'; key: string; name: string; typeName: string }
  | { kind: 'columnsLoading'; key: string }

/**
 * 行の高さの見積もり。
 *
 * 実寸は描いてから測るため、ここは初回の位置決めに使う概算でよい。
 */
const ESTIMATED_HEIGHTS: Record<TreeRow['kind'], number> = {
  schema: 26,
  kindGroup: 24,
  object: 24,
  column: 20,
  columnsLoading: 20,
}

/**
 * 列を所属オブジェクトごとに束ねる。
 *
 * 行ごとに `filter` すると、オブジェクト数 × 列数の手間がかかる。
 *
 * @param columns スキーマ 1 つ分の列
 */
function groupByObject(columns: TableColumn[]): Map<string, TableColumn[]> {
  const grouped = new Map<string, TableColumn[]>()
  for (const column of columns) {
    const 束 = grouped.get(column.objectName)
    if (束) {
      束.push(column)
    } else {
      grouped.set(column.objectName, [column])
    }
  }
  return grouped
}

/**
 * オブジェクトを種別ごとに束ねる（ADR 0014）。
 *
 * 並びは `OBJECT_KIND_ORDER` に従い、1 件も無い種別は束ごと出さない。
 * スキーマの中の並びは Rust 側で名前順に整えてあるため、ここでは崩さない。
 *
 * @param objects スキーマ 1 つ分のオブジェクト
 */
function groupByKind(objects: SchemaNode['objects']): [ObjectKind, SchemaNode['objects']][] {
  const grouped = new Map<ObjectKind, SchemaNode['objects']>()
  for (const object of objects) {
    const 束 = grouped.get(object.kind)
    if (束) {
      束.push(object)
    } else {
      grouped.set(object.kind, [object])
    }
  }

  return OBJECT_KIND_ORDER.filter((kind) => grouped.has(kind)).map((kind) => [
    kind,
    grouped.get(kind) as SchemaNode['objects'],
  ])
}

/**
 * 木を、開いている枝だけを含む平らな行の並びに直す。
 *
 * 畳んだ枝の中身は行にしない。閉じたものを描く手間はここで消える。
 * スキーマとオブジェクトの間には種別の束が 1 段挟まる（ADR 0014）。
 *
 * @param schemas 絞り込み済みのスキーマ
 * @param columns スキーマ名ごとの列
 * @param expanded 展開している節の表
 * @param groupsOpenByDefault 覚えていない束を開いたものとして扱うか。絞り込み中は真
 */
export function flattenSchemas(
  schemas: SchemaNode[],
  columns: Record<string, TableColumn[]>,
  expanded: Record<string, boolean>,
  groupsOpenByDefault = false,
): TreeRow[] {
  const rows: TreeRow[] = []

  for (const schema of schemas) {
    const schemaKey = nodeKey(schema.name)
    const schemaOpen = expanded[schemaKey] ?? false
    rows.push({
      kind: 'schema',
      key: schemaKey,
      name: schema.name,
      objectCount: schema.objectCount,
      open: schemaOpen,
    })

    if (!schemaOpen) {
      continue
    }

    const 列の束 = groupByObject(columns[schema.name] ?? [])

    for (const [objectKind, objects] of groupByKind(schema.objects)) {
      const groupKey = kindGroupKey(schema.name, objectKind)
      const groupOpen = expanded[groupKey] ?? groupsOpenByDefault
      rows.push({
        kind: 'kindGroup',
        key: groupKey,
        objectKind,
        count: objects.length,
        open: groupOpen,
      })

      if (!groupOpen) {
        continue
      }

      for (const object of objects) {
        const objectKey = nodeKey(schema.name, object.name)
        const expandable = EXPANDABLE.includes(object.kind)
        const objectOpen = expandable && (expanded[objectKey] ?? false)
        rows.push({
          kind: 'object',
          key: objectKey,
          owner: schema.name,
          name: object.name,
          objectKind: object.kind,
          expandable,
          open: objectOpen,
        })

        if (!objectOpen) {
          continue
        }

        const 列 = 列の束.get(object.name) ?? []
        if (列.length === 0) {
          rows.push({ kind: 'columnsLoading', key: `${objectKey} loading` })
          continue
        }
        for (const column of 列) {
          rows.push({
            kind: 'column',
            key: `${objectKey} ${column.name}`,
            name: column.name,
            typeName: column.typeName,
          })
        }
      }
    }
  }

  return rows
}

interface SchemaTreeProps {
  /**
   * 接続の識別子。テーブル定義ビューを開くのに要る（ADR 0019）。
   *
   * 繋がっていなければ `null`。そのときは「定義」を押せない。
   */
  connectionId: string | null
}

export function SchemaTree({ connectionId }: SchemaTreeProps) {
  const allSchemas = useSchemaStore((state) => state.schemas)
  const columns = useSchemaStore((state) => state.columns)
  const search = useSchemaStore((state) => state.search)
  const expanded = useSchemaStore((state) => state.expanded)
  const toggle = useSchemaStore((state) => state.toggle)
  const status = useSchemaStore((state) => state.status)
  const error = useSchemaStore((state) => state.error)
  const openDefinition = useDefinitionStore((state) => state.open)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 絞り込みは毎回新しい配列を作るため、ここで記憶しておく。
  const schemas = useMemo(
    () => filterSchemas(allSchemas, columns, search),
    [allSchemas, columns, search],
  )
  // 絞り込み中は束を開いたものとして扱う。当たったオブジェクトへ辿り着くのに
  // 束をいちいち開かせるのでは、検索の意味が薄れる。
  const rows = useMemo(
    () => flattenSchemas(schemas, columns, expanded, search.trim() !== ''),
    [columns, expanded, schemas, search],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ESTIMATED_HEIGHTS[rows[index].kind],
    overscan: 12,
  })

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
    <div ref={scrollRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={rows[item.index].key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
            }}
          >
            <Row
              row={rows[item.index]}
              onToggle={toggle}
              onOpenDefinition={
                connectionId === null ? null : (target) => void openDefinition(connectionId, target)
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 平らにした 1 行を、種類に応じて描き分ける。 */
function Row({
  row,
  onToggle,
  onOpenDefinition,
}: {
  row: TreeRow
  onToggle: (key: string, open: boolean) => void
  /** 定義ビューを開く。繋がっていなければ `null`（ADR 0019）。 */
  onOpenDefinition: ((target: DefinitionTarget) => void) | null
}) {
  if (row.kind === 'schema') {
    return (
      <button
        type="button"
        onClick={() => onToggle(row.key, !row.open)}
        aria-expanded={row.open}
        className="w-full flex items-center gap-7px px-10px py-5px bg-transparent border-none cursor-pointer font-inherit text-left text-12px text-fg hover:bg-fill"
      >
        {row.open ? (
          <ChevronDown size={13} className="text-fg5 shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-fg5 shrink-0" />
        )}
        <span className="flex-1 truncate">{row.name}</span>
        <span className="text-10.5px text-fg5">{row.objectCount}</span>
      </button>
    )
  }

  if (row.kind === 'kindGroup') {
    const Icon = KIND_ICONS[row.objectKind]
    return (
      <button
        type="button"
        onClick={() => onToggle(row.key, !row.open)}
        aria-expanded={row.open}
        className="w-full flex items-center gap-6px pl-22px pr-10px py-4px bg-transparent border-none cursor-pointer font-inherit text-left text-11.5px text-fg2 hover:bg-fill"
      >
        {row.open ? (
          <ChevronDown size={12} className="text-fg5 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-fg5 shrink-0" />
        )}
        <Icon size={13} className="text-fg5 shrink-0" />
        <span className="flex-1 truncate">{OBJECT_KIND_LABELS[row.objectKind]}</span>
        <span className="text-10.5px text-fg5 shrink-0">{row.count}</span>
      </button>
    )
  }

  if (row.kind === 'object') {
    const Icon = KIND_ICONS[row.objectKind]
    // 行そのものと「定義」は押しどころが違う。入れ子のボタンにできないため、
    // 行を包む器を 1 つ挟んで横に並べる。
    return (
      <div className="w-full flex items-center hover:bg-fill">
        <button
          type="button"
          onClick={() => (row.expandable ? onToggle(row.key, !row.open) : undefined)}
          aria-expanded={row.expandable ? row.open : undefined}
          className="min-w-0 flex-1 flex items-center gap-6px pl-38px pr-4px py-4px bg-transparent border-none cursor-pointer font-inherit text-left text-11.5px text-fg2"
        >
          <span className="w-13px shrink-0 flex items-center">
            {row.expandable ? (
              row.open ? (
                <ChevronDown size={12} className="text-fg5" />
              ) : (
                <ChevronRight size={12} className="text-fg5" />
              )
            ) : null}
          </span>
          <Icon size={13} className="text-fg5 shrink-0" />
          <span className="flex-1 truncate">{row.name}</span>
        </button>
        {onOpenDefinition === null ? null : (
          <button
            type="button"
            onClick={() =>
              onOpenDefinition({ owner: row.owner, name: row.name, kind: row.objectKind })
            }
            aria-label={`${row.name} の定義を開く`}
            className="shrink-0 mr-10px px-5px py-1px rounded-5px bg-transparent border-none text-10px text-fg5 cursor-pointer font-inherit hover:text-fg3"
          >
            定義
          </button>
        )}
      </div>
    )
  }

  if (row.kind === 'columnsLoading') {
    return <p className="m-0 pl-64px pr-10px py-3px text-11px text-fg5">列情報を読み込み中…</p>
  }

  return (
    <div className="flex items-center gap-8px pl-64px pr-10px py-3px text-11px">
      <span className="flex-1 truncate text-fg3">{row.name}</span>
      <span className="text-10.5px text-fg5 shrink-0">{row.typeName}</span>
    </div>
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
