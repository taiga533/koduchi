/**
 * 保存済みクエリの一覧（ADR 0018）。
 *
 * 作りは履歴の一覧（`HistoryList.tsx`）に揃えてある。スコープ切替を持ち、
 * 1 件ごとに削除できる点は同じで、違うのは名前を持つことと、既定のスコープが
 * 「全接続」であることだけである。
 *
 * 名前の変更は行の中で行う。そのためだけにダイアログを増やすほどの操作ではない。
 */

import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import type { SavedQuery } from '../../types/db'
import { useSavedQueryStore } from '../../stores/savedQuery'
import { isComposingKey } from '../../input/ime'

/** SQL の 1 行目だけを取り出して詰める。一覧では全文を出さない。 */
function summarize(sql: string): string {
  return sql.trim().split('\n')[0].slice(0, 120)
}

interface SavedQueryListProps {
  /** 保存済みクエリの SQL をエディタへ入れる。 */
  onUse: (sql: string) => void
}

export function SavedQueryList({ onUse }: SavedQueryListProps) {
  const entries = useSavedQueryStore((state) => state.entries)
  const scope = useSavedQueryStore((state) => state.scope)
  const setScope = useSavedQueryStore((state) => state.setScope)
  const rename = useSavedQueryStore((state) => state.rename)
  const remove = useSavedQueryStore((state) => state.remove)
  const loading = useSavedQueryStore((state) => state.loading)

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
          {loading ? '読み込んでいます…' : '保存したクエリがここに並びます'}
        </p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {entries.map((entry) => (
            <SavedQueryRow
              key={entry.id}
              entry={entry}
              onUse={onUse}
              onRename={rename}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface SavedQueryRowProps {
  entry: SavedQuery
  onUse: (sql: string) => void
  onRename: (id: number, name: string) => void
  onRemove: (id: number) => void
}

/** 保存済みクエリ 1 件。押すとエディタへ入り、鉛筆で名前を変え、✕ で消える。 */
function SavedQueryRow({ entry, onUse, onRename, onRemove }: SavedQueryRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.name)

  /** 名前の変更を確定する。空の名前は受け付けず、元の名前に戻す。 */
  const 確定する = (): void => {
    const name = draft.trim()
    if (name !== '' && name !== entry.name) {
      onRename(entry.id, name)
    } else {
      setDraft(entry.name)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="flex items-center gap-6px px-10px py-6px bg-fill">
        <input
          autoFocus
          value={draft}
          aria-label="クエリの名前"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // 変換中の `⏎` は変換の確定、`esc` は変換の取り消しである（ADR 0025）。
            if (isComposingKey(event)) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              確定する()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(entry.name)
              setEditing(false)
            }
          }}
          className="flex-1 min-w-0 px-6px py-3px rounded-6px bg-bg border border-line text-11.5px text-fg font-inherit"
        />
        <button
          type="button"
          onClick={確定する}
          aria-label="名前を確定する"
          className="shrink-0 flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
        >
          <Check size={13} />
        </button>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-6px px-10px py-6px hover:bg-fill">
      <button
        type="button"
        onClick={() => onUse(entry.sql)}
        className="flex-1 min-w-0 flex flex-col gap-3px bg-transparent border-none p-0 cursor-pointer font-inherit text-left"
      >
        <span className="text-11.5px text-fg2 truncate w-full">{entry.name}</span>
        <span className="text-10.5px text-fg5 truncate w-full">{summarize(entry.sql)}</span>
        <span className="text-10.5px text-fg5">{entry.connectionName}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(entry.name)
          setEditing(true)
        }}
        aria-label="このクエリの名前を変える"
        className="shrink-0 flex items-center bg-transparent border-none p-0 text-fg5 cursor-pointer font-inherit"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        aria-label="このクエリを削除"
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
