/**
 * サイドバー（デザイン 3a の左パネル）。
 *
 * スキーマ / 履歴 / 保存済み の 3 セグメントを持つ。スキーマは段階的に読み込まれ、
 * 列情報の読み込み中は下部に進捗を出す（ADR 0007）。保存済みクエリは履歴と同じ
 * 保管庫に入っており、同じ検索欄とスコープ切替で扱える（ADR 0018）。
 */

import { useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { formatColumnProgress, useSchemaStore } from '../../stores/schema'
import { useHistoryStore } from '../../stores/history'
import { useSavedQueryStore } from '../../stores/savedQuery'
import type { SidebarSegment } from '../../stores/ui'
import { useUiStore } from '../../stores/ui'
import { HistoryList } from './HistoryList'
import { SavedQueryList } from './SavedQueryList'
import { SchemaFilterMenu } from './SchemaFilterMenu'
import { SchemaTree } from './SchemaTree'

/** セグメントの並びと表示名。 */
const SEGMENTS: { id: SidebarSegment; label: string }[] = [
  { id: 'schema', label: 'スキーマ' },
  { id: 'history', label: '履歴' },
  { id: 'saved', label: '保存済み' },
]

/** 絞り込み入力に出す説明文。セグメントごとに変わる。 */
const FILTER_LABELS: Record<SidebarSegment, string> = {
  schema: 'スキーマを絞り込む',
  history: '履歴を検索',
  saved: '保存済みを検索',
}

interface SidebarProps {
  /** 接続の識別子。未接続なら `null`。 */
  connectionId: string | null
  /** `connections.toml` に保存されている接続の ID。保存していなければ `null`。 */
  savedConnectionId: string | null
  /** 接続の表示名。履歴のスコープ絞り込みに使う。 */
  connectionName: string | null
  /** 別の接続を新しいウィンドウで開く。 */
  onOpenNewConnection: () => void
  /** 履歴と保存済みクエリの SQL をエディタへ入れる。 */
  onUseHistory: (sql: string) => void
  /** サイドバーの幅（px）。境界のドラッグで変わる。 */
  width: number
}

export function Sidebar({
  connectionId,
  savedConnectionId,
  connectionName,
  onOpenNewConnection,
  onUseHistory,
  width,
}: SidebarProps) {
  const segment = useUiStore((state) => state.sidebarSegment)
  const selectSegment = useUiStore((state) => state.selectSidebarSegment)

  const schemaSearch = useSchemaStore((state) => state.search)
  const setSchemaSearch = useSchemaStore((state) => state.setSearch)
  const progress = useSchemaStore(formatColumnProgress)
  const reloadSchemas = useSchemaStore((state) => state.reload)

  const historySearch = useHistoryStore((state) => state.search)
  const setHistorySearch = useHistoryStore((state) => state.setSearch)
  const reloadHistory = useHistoryStore((state) => state.reload)
  const setHistoryConnection = useHistoryStore((state) => state.setConnectionName)

  const savedSearch = useSavedQueryStore((state) => state.search)
  const setSavedSearch = useSavedQueryStore((state) => state.setSearch)
  const reloadSaved = useSavedQueryStore((state) => state.reload)
  const setSavedConnection = useSavedQueryStore((state) => state.setConnectionName)

  // 履歴の絞り込み条件はストアが持つ。ここでは対象の接続を伝え、履歴を開いた
  // ときに読み直すだけでよい。スコープと検索語の変化はストア側で拾う。
  useEffect(() => {
    setHistoryConnection(connectionName)
    if (segment === 'history') {
      void reloadHistory()
    }
  }, [connectionName, reloadHistory, segment, setHistoryConnection])

  // 保存済みクエリも同じ形で扱う（ADR 0018）。
  useEffect(() => {
    setSavedConnection(connectionName)
    if (segment === 'saved') {
      void reloadSaved()
    }
  }, [connectionName, reloadSaved, segment, setSavedConnection])

  // 検索欄は 1 つで、セグメントごとに宛先のストアを差し替える。
  const search =
    segment === 'history' ? historySearch : segment === 'saved' ? savedSearch : schemaSearch
  const setSearch =
    segment === 'history'
      ? setHistorySearch
      : segment === 'saved'
        ? setSavedSearch
        : setSchemaSearch

  return (
    <aside
      style={{ width: `${width}px` }}
      className="shrink-0 bg-panel rounded-10px border border-line flex flex-col overflow-hidden"
    >
      <div className="p-9px flex flex-col gap-8px border-b border-line2">
        <div className="flex gap-2px p-2px rounded-8px bg-line2">
          {SEGMENTS.map((item) => {
            const active = item.id === segment
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSegment(item.id)}
                className={`flex-1 flex items-center justify-center py-4px rounded-6px text-12px border-none cursor-pointer font-inherit ${
                  active
                    ? 'bg-panel text-fg shadow-[0_0_0_1px_rgba(24,28,38,.12)]'
                    : 'bg-transparent text-fg3'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-6px">
          <div className="flex-1 flex items-center gap-8px px-9px py-4px rounded-7px bg-fill">
            <Search size={14} className="text-fg5 shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={FILTER_LABELS[segment]}
              aria-label={FILTER_LABELS[segment]}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-12px text-fg font-inherit placeholder:text-fg4"
            />
          </div>
          {segment === 'schema' ? (
            <SchemaFilterMenu
              connectionId={connectionId}
              savedConnectionId={savedConnectionId}
              onReload={reloadSchemas}
            />
          ) : null}
        </div>
      </div>

      {/* スキーマツリーは仮想スクロールのため、自前のスクロール枠を持つ。 */}
      <div
        className={`flex-1 min-h-0 ${segment === 'schema' ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        {segment === 'schema' ? <SchemaTree connectionId={connectionId} /> : null}
        {segment === 'history' ? <HistoryList onUse={onUseHistory} /> : null}
        {segment === 'saved' ? <SavedQueryList onUse={onUseHistory} /> : null}
      </div>

      {segment === 'schema' && progress !== '' ? (
        <p className="m-0 px-11px py-6px border-t border-line2 text-10.5px text-fg4">{progress}</p>
      ) : null}

      <button
        type="button"
        onClick={onOpenNewConnection}
        className="px-12px py-8px border-t border-line2 border-l-none border-r-none border-b-none flex items-center gap-7px text-12px text-fg3 bg-transparent cursor-pointer font-inherit text-left"
      >
        <Plus size={15} className="text-fg5" />
        別の接続
      </button>
    </aside>
  )
}
