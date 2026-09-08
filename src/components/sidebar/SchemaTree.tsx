/**
 * スキーマツリー（ADR 0007・0014・0019・0020）。
 *
 * スキーマ行の右にオブジェクト数を出し、展開すると**種別ごとの束**が並ぶ。
 * 束を開くとその種別のオブジェクトが並び、テーブルとビューはさらに展開できて
 * 読み込み済みの列が型付きで出る。
 *
 * 種別で束ねるのは、索引やシノニムまで載せると 1 スキーマのオブジェクトが
 * 数千行に届くためである。束ねてあれば、スキーマを開いたときに増える行数は
 * 種別の数（高々 12）に収まる（ADR 0014）。
 *
 * 木のまま描くと、描き直しの手間が中身の量に比例する。Oracle のスキーマは
 * オブジェクトが数千に達することがあり、列の読み込みが進むたびに全体を組み直すと
 * 絞り込みの入力が目に見えて詰まる。そこで一度平らな行の並びに直し、見えている
 * 分だけを描く（結果テーブルと同じ TanStack Virtual）。
 *
 * ここからエディタへ手を伸ばせる（ADR 0020）。マウスの操作は場所と回数で
 * 割り振ってあり、互いに食い合わない。
 *
 * | 操作                 | 起きること                                    |
 * | -------------------- | --------------------------------------------- |
 * | 行を単クリック       | 開閉する（開けない行では何も起きない）        |
 * | 行をダブルクリック   | 名前をエディタのカーソル位置へ挿入する        |
 * | 行を右クリック       | 名前のコピー・挿入・`SELECT` を開くのメニュー |
 * | 「定義」を単クリック | テーブル定義ビューを開く（ADR 0019）          |
 *
 * ダブルクリックは 1 回目と 2 回目の押し下げでそれぞれ `onClick` が起き、開閉が
 * 2 度切り替わって元の状態へ戻る。**打ち消す細工はしない。**結果テーブルの
 * 「ダブルクリックは 1 回目の押し下げで選択も起こる」と同じ扱いである。
 *
 * 「定義」は行とは別の押しどころであり、行のクリックの意味を変えない
 * （ADR 0019）。そのため**「定義」の上ではダブルクリックの挿入を起こさない**。
 * ボタンを 2 度押したのは押した人の意図であり、そこに挿入まで重ねない。
 * 右クリックだけは行と同じメニューを出す（「定義」もその行の一部だからである）。
 *
 * 挿入する綴りと引用符は `identifiers.ts` が決める（ADR 0013）。文字列の
 * 組み立ては `editor/insertion.ts` の純粋な関数に寄せてある。
 */

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { getClipboardApi } from '../../api/clipboard'
import type { DefinitionTarget, ObjectKind, SchemaNode, TableColumn } from '../../types/db'
import { OBJECT_KIND_LABELS, OBJECT_KIND_ORDER, defaultCompletionSettings } from '../../types/db'
import { useConnectionStore } from '../../stores/connection'
import { useDefinitionStore } from '../../stores/definition'
import { filterSchemas, kindGroupKey, nodeKey, useSchemaStore } from '../../stores/schema'
import { qualifiedIdentifier, selectAllStatement } from '../editor/insertion'
import { SchemaTreeContextMenu } from './SchemaTreeContextMenu'

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

/**
 * 行の中の、行そのものとは別の押しどころに付ける目印。
 *
 * 今のところ「定義」のボタンだけである。ここでのダブルクリックは行への挿入に
 * 使わない（ADR 0019・0020）。
 */
const ROW_ACTION = 'data-row-action'

/** 平らにした 1 行。仮想スクロールに載せる単位である。 */
export type TreeRow =
  | { kind: 'schema'; key: string; name: string; objectCount: number; open: boolean }
  | { kind: 'kindGroup'; key: string; objectKind: ObjectKind; count: number; open: boolean }
  | {
      kind: 'object'
      key: string
      /**
       * 所有者のスキーマ名。
       *
       * 定義ビューを開くのに要り（ADR 0019）、挿入する名前をスキーマで修飾する
       * のにも使う（ADR 0020）。`ALL_OBJECTS.OWNER` と同じ意味である。
       */
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
 * 行が指す名前を、外側から並べて返す（ADR 0020）。
 *
 * オブジェクトは所有者のスキーマで修飾する。ツリーが**どのスキーマの下で
 * 見つけたか**を知っている唯一の場所だからである。**列は修飾しない。**
 * `SELECT` の並びや `WHERE` へ貼るのが主な使い道であり、そこでは表の別名で
 * 修飾するか、修飾しないかのどちらかになる。
 *
 * 種別の束と読み込み中の行は名前を持たないため `null` を返す。
 *
 * @param row 平らにした 1 行
 */
export function rowIdentifierPath(row: TreeRow): string[] | null {
  switch (row.kind) {
    case 'schema':
      return [row.name]
    case 'object':
      return [row.owner, row.name]
    case 'column':
      return [row.name]
    default:
      return null
  }
}

/**
 * `SELECT` を開ける行か。
 *
 * 列を持つ種別（表・ビュー・マテビュー）だけである。索引や手続に
 * `select * from` を当てても動く SQL にならない。
 *
 * @param row 平らにした 1 行
 */
export function canOpenSelect(row: TreeRow): boolean {
  return row.kind === 'object' && EXPANDABLE.includes(row.objectKind)
}

/**
 * 開閉できる行か。矢印キーの左右で開け閉めする対象である。
 *
 * @param row 平らにした 1 行
 */
function isOpenable(row: TreeRow): row is Extract<TreeRow, { open: boolean }> {
  return (
    row.kind === 'schema' || row.kind === 'kindGroup' || (row.kind === 'object' && row.expandable)
  )
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
 * オブジェクトの行には所有者のスキーマ名を持たせる。定義ビュー（ADR 0019）と
 * 挿入する名前の修飾（ADR 0020）の両方が要るためであり、鍵の文字列を `.` で
 * 割って取り出すのは名前に `.` を含む識別子で壊れる。
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
  /**
   * 名前をエディタのカーソル位置へ入れる（ADR 0020）。
   *
   * 受け取るのは組み立て済みの文字列である。綴りをどう決めたかはツリーの
   * 関心であり、差し込む位置と空白の要否はエディタの関心である。
   */
  onInsert: (text: string) => void
  /** `select * from …` を新しいタブに開く。実行はしない。 */
  onOpenSelect: (sql: string) => void
}

export function SchemaTree({ connectionId, onInsert, onOpenSelect }: SchemaTreeProps) {
  const allSchemas = useSchemaStore((state) => state.schemas)
  const columns = useSchemaStore((state) => state.columns)
  const search = useSchemaStore((state) => state.search)
  const expanded = useSchemaStore((state) => state.expanded)
  const toggle = useSchemaStore((state) => state.toggle)
  const status = useSchemaStore((state) => state.status)
  const error = useSchemaStore((state) => state.error)
  const openDefinition = useDefinitionStore((state) => state.open)

  // 挿入する綴りは接続ごとの設定である（ADR 0013）。補完と同じ値を引く。
  const identifierCase = useConnectionStore(
    (state) =>
      state.connection?.completion.identifierCase ?? defaultCompletionSettings.identifierCase,
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: TreeRow } | null>(null)
  // 焦点のある行。仮想スクロールでは描かれていない行に焦点を当てられないため、
  // 位置だけを覚えておき、描かれた時点で DOM の焦点を合わせる。
  const [focusedIndex, setFocusedIndex] = useState(0)
  const focusPending = useRef(false)

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

  // 絞り込みや開閉で行が減ると、覚えている位置が並びの外へ出る。
  const focused = Math.min(focusedIndex, Math.max(0, rows.length - 1))

  // 焦点を当てる行が描かれるまで待つ。描かれていなければ次の描画で試し直す。
  useEffect(() => {
    if (!focusPending.current) {
      return
    }
    const target = scrollRef.current?.querySelector<HTMLElement>('[data-tree-focused="true"]')
    if (target) {
      focusPending.current = false
      target.focus()
    }
  })

  /** 名前をエディタへ入れる。名前を持たない行では何もしない。 */
  const insertRow = (row: TreeRow) => {
    const path = rowIdentifierPath(row)
    if (path) {
      onInsert(qualifiedIdentifier(path, identifierCase))
    }
  }

  /** 名前をクリップボードへ書く。挿入するのと同じ綴りで書く。 */
  const copyRow = (row: TreeRow) => {
    const path = rowIdentifierPath(row)
    if (path) {
      void getClipboardApi().writeText(qualifiedIdentifier(path, identifierCase))
    }
  }

  /** `select * from …` を新しいタブに開く。 */
  const openSelectFor = (row: TreeRow) => {
    if (row.kind === 'object' && canOpenSelect(row)) {
      onOpenSelect(selectAllStatement([row.owner, row.name], identifierCase))
    }
  }

  /** 焦点を別の行へ移す。並びの外へは出さない。 */
  const moveFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, next))
    virtualizer.scrollToIndex(clamped)
    focusPending.current = true
    setFocusedIndex(clamped)
  }

  /**
   * ツリーの中でだけ効くキー（ADR 0020）。
   *
   * `⏎` と `Space` は行そのものの押し下げ（開閉）であり、ここでは扱わない。
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) {
      return
    }
    const row = rows[focused]

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(focused + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(focused - 1)
      return
    }
    if (event.key === 'ArrowRight') {
      if (isOpenable(row) && !row.open) {
        event.preventDefault()
        toggle(row.key, true)
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      if (isOpenable(row) && row.open) {
        event.preventDefault()
        toggle(row.key, false)
      }
      return
    }
    if (event.key === 'Enter' && event.altKey) {
      // `⏎` 単独は開閉である。挿入は修飾を足して分ける。
      event.preventDefault()
      insertRow(row)
      return
    }
    if (event.key.toLowerCase() === 'c' && event.metaKey) {
      event.preventDefault()
      copyRow(row)
    }
  }

  /**
   * ダブルクリック。名前をカーソル位置へ入れる。
   *
   * 「定義」の上では起こさない。行とは別の押しどころであり、ボタンを 2 度
   * 押したことに挿入まで重ねない（ADR 0019・0020）。
   */
  const onDoubleClick = (event: ReactMouseEvent, row: TreeRow) => {
    if (event.target instanceof Element && event.target.closest(`[${ROW_ACTION}]`)) {
      return
    }
    insertRow(row)
  }

  /** 右クリック。名前を持たない行ではメニューを出さない。 */
  const openMenu = (event: ReactMouseEvent, row: TreeRow) => {
    if (rowIdentifierPath(row) === null) {
      return
    }
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, row })
  }

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
    <div
      ref={scrollRef}
      data-testid="schema-tree"
      className="h-full overflow-auto"
      onKeyDown={onKeyDown}
    >
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
            onDoubleClick={(event) => onDoubleClick(event, rows[item.index])}
            onContextMenu={(event) => openMenu(event, rows[item.index])}
          >
            <Row
              row={rows[item.index]}
              focused={item.index === focused}
              onToggle={toggle}
              onFocus={() => setFocusedIndex(item.index)}
              onOpenDefinition={
                connectionId === null ? null : (target) => void openDefinition(connectionId, target)
              }
            />
          </div>
        ))}
      </div>
      {menu ? (
        <SchemaTreeContextMenu
          x={menu.x}
          y={menu.y}
          target={qualifiedIdentifier(rowIdentifierPath(menu.row) ?? [], identifierCase)}
          canSelect={canOpenSelect(menu.row)}
          onCopy={() => {
            copyRow(menu.row)
            setMenu(null)
          }}
          onInsert={() => {
            insertRow(menu.row)
            setMenu(null)
          }}
          onOpenSelect={() => {
            openSelectFor(menu.row)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

interface RowProps {
  row: TreeRow
  /** 焦点を当てる行か。行き来する焦点は 1 つだけである（roving tabindex）。 */
  focused: boolean
  onToggle: (key: string, open: boolean) => void
  onFocus: () => void
  /** 定義ビューを開く。繋がっていなければ `null`（ADR 0019）。 */
  onOpenDefinition: ((target: DefinitionTarget) => void) | null
}

/** 平らにした 1 行を、種類に応じて描き分ける。 */
function Row({ row, focused, onToggle, onFocus, onOpenDefinition }: RowProps) {
  // 焦点を持てるのは 1 行だけにする。仮想スクロールで描かれている行がすべて
  // タブ順に並ぶと、ツリーを抜けるのに数十回打鍵することになる。
  const focus = { tabIndex: focused ? 0 : -1, 'data-tree-focused': focused, onFocus }

  if (row.kind === 'schema') {
    return (
      <button
        type="button"
        {...focus}
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
        {...focus}
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
    // 行を包む器を 1 つ挟んで横に並べる（ADR 0019）。焦点は行そのものが持ち、
    // 「定義」へは `Tab` で降りる（ADR 0020 の roving tabindex）。
    return (
      <div className="w-full flex items-center hover:bg-fill">
        <button
          type="button"
          {...focus}
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
            {...{ [ROW_ACTION]: true }}
            tabIndex={focused ? 0 : -1}
            onFocus={onFocus}
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
    return (
      <p {...focus} className="m-0 pl-64px pr-10px py-3px text-11px text-fg5">
        列情報を読み込み中…
      </p>
    )
  }

  return (
    <div {...focus} className="flex items-center gap-8px pl-64px pr-10px py-3px text-11px">
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
