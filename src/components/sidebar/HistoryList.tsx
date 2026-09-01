/**
 * 履歴の一覧（ADR 0005）。
 *
 * 「この接続のみ / 全接続」のスコープを切り替えられる。1 件ごとの削除を
 * 用意してあるのは、`alter user … identified by …` のような SQL が平文で
 * 残るためである。
 */

import { X } from 'lucide-react'
import type { HistoryEntry } from '../../types/db'
import { useHistoryStore } from '../../stores/history'

/** SQL の 1 行目だけを取り出して詰める。一覧では全文を出さない。 */
function summarize(sql: string): string {
  return sql.trim().split('\n')[0].slice(0, 120)
}

/** 実行時刻を短い表記にする。 */
function formatTime(startedAt: number): string {
  return new Date(startedAt).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface HistoryListProps {
  /** 履歴の SQL をエディタへ入れる。 */
  onUse: (sql: string) => void
}

export function HistoryList({ onUse }: HistoryListProps) {
  const entries = useHistoryStore((state) => state.entries)
  const scope = useHistoryStore((state) => state.scope)
  const setScope = useHistoryStore((state) => state.setScope)
  const remove = useHistoryStore((state) => state.remove)
  const loading = useHistoryStore((state) => state.loading)

  return (
    <div className="flex flex-col">
      <div className="flex gap-2px px-9px py-6px">
        <ScopeButton active={scope === 'connection'} onClick={() => setScope('connection')}>
          この接続のみ
        </ScopeButton>
        <ScopeButton active={scope === 'all'} onClick={() => setScope('all')}>
          全接続
        </ScopeButton>
      </div>

      {entries.length === 0 ? (
        <p className="m-0 px-14px py-16px text-12px leading-[1.6] text-fg5 text-center">
          {loading ? '読み込んでいます…' : '実行した SQL がここに残ります'}
        </p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} onUse={onUse} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  )
}

interface HistoryRowProps {
  entry: HistoryEntry
  onUse: (sql: string) => void
  onRemove: (id: number) => void
}

/** 履歴 1 件。押すとエディタへ入り、✕ で 1 件だけ消える。 */
function HistoryRow({ entry, onUse, onRemove }: HistoryRowProps) {
  return (
    <li className="flex items-start gap-6px px-10px py-6px hover:bg-fill">
      <button
        type="button"
        onClick={() => onUse(entry.sql)}
        className="flex-1 min-w-0 flex flex-col gap-3px bg-transparent border-none p-0 cursor-pointer font-inherit text-left"
      >
        <span className="text-11.5px text-fg2 truncate w-full">{summarize(entry.sql)}</span>
        <span className="flex items-center gap-8px text-10.5px text-fg5">
          <span>{formatTime(entry.startedAt)}</span>
          <span>{entry.connectionName}</span>
          {entry.succeeded ? (
            <span>
              {entry.rowCount === null ? '' : `${entry.rowCount.toLocaleString('ja-JP')} 行 · `}
              {entry.elapsedMs} ms
            </span>
          ) : (
            <span className="text-err">失敗</span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        aria-label="この履歴を削除"
        className="shrink-0 flex items-center bg-transparent border-none p-0 text-fg5 cursor-pointer font-inherit"
      >
        <X size={13} />
      </button>
    </li>
  )
}

/** スコープ切替のボタン。 */
function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-8px py-3px rounded-6px text-11px border-none cursor-pointer font-inherit ${
        active ? 'bg-fill text-fg' : 'bg-transparent text-fg4'
      }`}
    >
      {children}
    </button>
  )
}
