/**
 * コマンドパレット（`⌘K`、ADR 0018）。
 *
 * 探せるのは現ウィンドウの接続の中だけである。コマンド・スキーマのオブジェクト・
 * 保存済みクエリ・履歴の 4 種を、種別の見出しを付けて 1 つの並びに出す。
 * 絞り込みと並べ替えは `paletteSearch.ts` の純粋な関数が担う。
 *
 * 保存済みクエリと履歴は開いた時点で 1 度だけ読み、あとは手元で絞る。打鍵の
 * たびに SQLite へ往復すると、入力が目に見えて詰まるためである。スキーマは
 * 既にストアの中にあるものを使う（ADR 0007 の段階 1）。列は候補にしない。
 * 数万件になりうるうえ、表を先に決めれば補完で辿れる（ADR 0013）。
 *
 * キーボードだけで完結する。↑↓ で移動、⏎ で決定、esc で閉じる。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Search, Star, Table2, Terminal, type LucideIcon } from 'lucide-react'
import { getDbApi } from '../../api/db'
import { useSchemaStore } from '../../stores/schema'
import type { HistoryEntry, SavedQuery, SchemaNode } from '../../types/db'
import type { PaletteEntry, PaletteKind } from './paletteSearch'
import {
  filterPaletteEntries,
  flattenPaletteGroups,
  movePaletteSelection,
  summarizeSql,
} from './paletteSearch'

/** パレットから呼べる動作 1 つ。 */
export interface PaletteCommand {
  /** 種別の中で一意な鍵。 */
  id: string
  /** 一覧に出す名前。 */
  label: string
  /** 右端に出すキー表記。無いものは空文字列。 */
  shortcut: string
  run: () => void
}

/** 絞り込みに掛ける候補 1 件。決めたときに走らせる動作を提げている。 */
interface PaletteItem extends PaletteEntry {
  run: () => void
}

/** パレットが 1 度に読む保存済みクエリと履歴の件数。 */
export const PALETTE_FETCH_LIMIT = 200

/** 種別ごとの目印。 */
const KIND_ICONS: Record<PaletteKind, LucideIcon> = {
  command: Terminal,
  schema: Table2,
  saved: Star,
  history: Clock,
}

interface CommandPaletteProps {
  /** 接続の表示名。履歴を現ウィンドウの接続に絞るのに使う。 */
  connectionName: string
  /** 既存のキーバインドで呼べる動作。 */
  commands: PaletteCommand[]
  /** 保存済みクエリと履歴の SQL をエディタへ入れる。 */
  onUseSql: (sql: string) => void
  /** スキーマのオブジェクトをサイドバーのツリーで示す。 */
  onRevealSchemaObject: (schemaName: string, objectName: string | null) => void
  /** esc または決定の後に閉じる。 */
  onClose: () => void
}

export function CommandPalette({
  connectionName,
  commands,
  onUseSql,
  onRevealSchemaObject,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const schemas = useSchemaStore((state) => state.schemas)
  const schemaStatus = useSchemaStore((state) => state.status)

  // 開いた時点の写しを 1 度だけ取る。保存済みクエリは全接続ぶんを出す。接続を
  // またいで使い回す道具であり、隣のウィンドウで保存したものが消えていると
  // 探し物にならないためである。履歴は現ウィンドウの接続ぶんに絞る。
  useEffect(() => {
    let 生きている = true

    void Promise.all([
      getDbApi().listSavedQueries({
        connectionName: null,
        search: null,
        limit: PALETTE_FETCH_LIMIT,
      }),
      getDbApi().listHistory({ connectionName, search: null, limit: PALETTE_FETCH_LIMIT }),
    ])
      .then(([saved, entries]) => {
        if (生きている) {
          setSavedQueries(saved)
          setHistory(entries)
        }
      })
      .catch(() => {
        // 読めなくてもコマンドとスキーマは探せる。パレットごと閉じる理由にはしない。
      })

    return () => {
      生きている = false
    }
  }, [connectionName])

  const items = useMemo<PaletteItem[]>(
    () =>
      buildPaletteItems({
        commands,
        schemas,
        savedQueries,
        history,
        onUseSql,
        onRevealSchemaObject,
        onClose,
      }),
    [commands, history, onClose, onRevealSchemaObject, onUseSql, savedQueries, schemas],
  )

  const groups = useMemo(() => filterPaletteEntries(items, query), [items, query])
  const flat = useMemo(() => flattenPaletteGroups(groups), [groups])

  // 絞り込みが変われば候補の数も変わる。選択が外へはみ出さないようにする。
  const position = selected < flat.length ? selected : 0

  /** 選んでいるものを走らせる。 */
  const 決定する = (): void => {
    flat[position]?.run()
  }

  /** 選択を動かし、画面の外へ出たら追う。 */
  const 動かす = (delta: number): void => {
    const next = movePaletteSelection(flat.length, position, delta)
    setSelected(next)
    listRef.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-[rgba(24,28,38,.28)] px-24px pt-96px"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          動かす(1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          動かす(-1)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          決定する()
        }
      }}
    >
      <div
        role="dialog"
        aria-label="コマンドパレット"
        className="w-560px max-w-full bg-panel rounded-10px border border-line overflow-hidden flex flex-col"
      >
        <div className="flex items-center gap-9px px-12px py-9px border-b border-line2">
          <Search size={14} className="text-fg5 shrink-0" />
          <input
            autoFocus
            value={query}
            aria-label="テーブル・クエリ・コマンドを検索"
            placeholder="テーブル・クエリ・コマンドを検索"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-13px text-fg font-inherit placeholder:text-fg4"
          />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="検索結果"
          className="max-h-360px overflow-y-auto"
        >
          {groups.map((group) => (
            <div key={group.kind} role="group" aria-label={group.label}>
              <p className="m-0 px-12px pt-8px pb-4px text-10.5px text-fg5">{group.label}</p>
              {group.entries.map((entry) => {
                const index = flat.indexOf(entry)
                const Icon = KIND_ICONS[entry.kind]
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={index === position}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => entry.run()}
                    className={`w-full flex items-center gap-9px px-12px py-6px border-none cursor-pointer font-inherit text-left ${
                      index === position ? 'bg-fill' : 'bg-transparent'
                    }`}
                  >
                    <Icon size={13} className="text-fg5 shrink-0" />
                    <span className="flex-1 min-w-0 text-12px text-fg2 truncate">
                      {entry.label}
                    </span>
                    {entry.detail === '' ? null : (
                      <span className="shrink-0 text-10.5px text-fg5">{entry.detail}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {flat.length === 0 ? (
          <p className="m-0 px-14px py-16px text-12px text-fg5 text-center">
            当てはまるものがありません
          </p>
        ) : null}

        <p className="m-0 px-12px py-7px border-t border-line2 text-10.5px text-fg5">
          {schemaStatus === 'loading'
            ? 'スキーマを読み込んでいます… ↑↓ で移動、⏎ で決定、esc で閉じる'
            : '↑↓ で移動、⏎ で決定、esc で閉じる'}
        </p>
      </div>
    </div>
  )
}

/**
 * パレットに並べる候補を組み立てる。
 *
 * スキーマはオブジェクトとスキーマ名だけを候補にする。列は数万件になりうるうえ、
 * 表を先に決めればエディタの補完で辿れる（ADR 0013）。
 *
 * @param sources 候補の元になるもの
 */
function buildPaletteItems(sources: {
  commands: PaletteCommand[]
  schemas: SchemaNode[]
  savedQueries: SavedQuery[]
  history: HistoryEntry[]
  onUseSql: (sql: string) => void
  onRevealSchemaObject: (schemaName: string, objectName: string | null) => void
  onClose: () => void
}): PaletteItem[] {
  const { commands, schemas, savedQueries, history, onUseSql, onRevealSchemaObject, onClose } =
    sources

  /** 決めたら必ずパレットを閉じる。 */
  const 決めたら閉じる = (work: () => void) => () => {
    work()
    onClose()
  }

  const items: PaletteItem[] = commands.map((command) => ({
    id: `command:${command.id}`,
    kind: 'command',
    label: command.label,
    detail: command.shortcut,
    run: 決めたら閉じる(command.run),
  }))

  for (const schema of schemas) {
    items.push({
      id: `schema:${schema.name}`,
      kind: 'schema',
      label: schema.name,
      detail: `${schema.objectCount.toLocaleString('ja-JP')} 件`,
      run: 決めたら閉じる(() => onRevealSchemaObject(schema.name, null)),
    })

    for (const object of schema.objects) {
      items.push({
        id: `object:${schema.name}.${object.name}`,
        kind: 'schema',
        label: object.name,
        detail: schema.name,
        run: 決めたら閉じる(() => onRevealSchemaObject(schema.name, object.name)),
      })
    }
  }

  for (const saved of savedQueries) {
    items.push({
      id: `saved:${saved.id}`,
      kind: 'saved',
      label: saved.name,
      detail: saved.connectionName,
      run: 決めたら閉じる(() => onUseSql(saved.sql)),
    })
  }

  // 同じ SQL を何度も実行した履歴で埋まらないよう、本文の重複は先頭だけ残す。
  const 出した = new Set<string>()
  for (const entry of history) {
    if (出した.has(entry.sql)) {
      continue
    }
    出した.add(entry.sql)
    items.push({
      id: `history:${entry.id}`,
      kind: 'history',
      label: summarizeSql(entry.sql),
      detail: '',
      run: 決めたら閉じる(() => onUseSql(entry.sql)),
    })
  }

  return items
}
