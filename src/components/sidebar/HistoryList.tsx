/**
 * 履歴の一覧（ADR 0005）。
 *
 * 「この接続のみ / 全接続」のスコープを切り替えられる。1 件ごとの削除を
 * 用意してあるのは、`alter user … identified by …` のような SQL が平文で
 * 残るためである。
 *
 * 行の右クリックでメニューを出す（ADR 0038。`SqlEntryContextMenu.tsx`）。
 *
 * 成否で絞れ、フォーカスした行（キーボードの焦点かホバー）の全文を右隣に
 * 出す（ADR 0046。`HistoryPreview.tsx`）。
 */

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getClipboardApi } from '../../api/clipboard'
import type { HistoryEntry } from '../../types/db'
import { isComposingKey } from '../../input/ime'
import { type HistoryOutcome, useHistoryStore } from '../../stores/history'
import type { RowAnchor } from './previewPlacement'
import { HistoryPreview } from './HistoryPreview'
import { SqlEntryContextMenu } from './SqlEntryContextMenu'
import { type MeasureRow, useHistoryPreview } from './useHistoryPreview'

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
  /** 履歴の SQL を新しいタブに入れる。実行はしない（ADR 0038）。 */
  onOpenInNewTab: (sql: string) => void
  /**
   * 履歴の 1 件を保存済みクエリへ足す（ADR 0041）。
   *
   * 積めたときはその名前で解く。取り消しと失敗は `null`。
   */
  onSaveQuery: (entry: HistoryEntry) => Promise<string | null>
}

/** 「追加しました」を出しておく時間（ミリ秒）。コピーの一言と揃える。 */
const NOTICE_MS = 2500

/** 成否の絞り込みの並び。左から広い順。 */
const OUTCOMES: { value: HistoryOutcome; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失敗' },
]

/**
 * 空のときの一言。
 *
 * 絞り込んだ結果が空なのか、そもそも履歴が無いのかを言い分ける。同じ一言だと
 * 絞ったことを忘れて「履歴が消えた」と読まれる。
 *
 * @param outcome 成否の絞り込み
 */
function emptyMessage(outcome: HistoryOutcome): string {
  switch (outcome) {
    case 'all':
      return '実行した SQL がここに残ります'
    case 'succeeded':
      return '成功した実行はありません'
    case 'failed':
      return '失敗した実行はありません'
  }
}

/** 行の本体の印。`↑` / `↓` で焦点を送る先を DOM から引くために付ける。 */
const ROW_ATTRIBUTE = 'data-history-row'

/** 行（`li`）の印。プレビューの位置を測り直すときに履歴の ID から引く。 */
const ENTRY_ATTRIBUTE = 'data-history-id'

/**
 * `↑` / `↓` で隣の行の本体へ焦点を送る。
 *
 * 全文プレビューはキーボードの焦点でも開く（ADR 0046）。行ごとに `✕` があるため
 * `Tab` だけで辿ると 2 打鍵に 1 行しか進まず、見比べにくい。
 *
 * @param event 一覧で起きた打鍵
 */
function moveRowFocus(event: React.KeyboardEvent<HTMLUListElement>): void {
  if (isComposingKey(event.nativeEvent)) {
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return
  }
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[${ROW_ATTRIBUTE}]`))
  const index = rows.findIndex((row) => row === document.activeElement)
  if (index === -1) {
    return
  }
  // 端の行でも既定の動きは止める。止めないと器が矢印でスクロールし、焦点は
  // 動かないのにプレビューだけが行からずれる。
  event.preventDefault()
  const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1]
  if (next === undefined) {
    return
  }
  // `focus()` に任せたスクロールは焦点が当たった後に起き、`onFocus` で測った
  // 位置が古くなる。見せる分だけを自分で送り、スクロールの後で測り直させる
  // （`useHistoryPreview` の `scrolled`）。
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest' })
}

/** 右クリックのメニューの状態。 */
interface MenuState {
  x: number
  y: number
  entry: HistoryEntry
}

export function HistoryList({ onUse, onOpenInNewTab, onSaveQuery }: HistoryListProps) {
  const entries = useHistoryStore((state) => state.entries)
  const scope = useHistoryStore((state) => state.scope)
  const setScope = useHistoryStore((state) => state.setScope)
  const outcome = useHistoryStore((state) => state.outcome)
  const setOutcome = useHistoryStore((state) => state.setOutcome)
  const remove = useHistoryStore((state) => state.remove)
  const loading = useHistoryStore((state) => state.loading)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const preview = useHistoryPreview()
  const { close: closePreview, reanchor, scrolled } = preview
  const previewId = useId()
  const listRef = useRef<HTMLUListElement | null>(null)

  // 一覧に居ない行は測らない。絞り込みや削除で消えた行のプレビューを閉じさせる。
  const measure = useCallback<MeasureRow>(
    (entryId) => {
      if (!entries.some((entry) => entry.id === entryId)) {
        return null
      }
      const row = listRef.current?.querySelector(`[${ENTRY_ATTRIBUTE}="${entryId}"]`)
      return row ? anchorOf(row) : null
    },
    [entries],
  )

  // 読み直し（実行のたびに先頭へ行が入る）や削除で行が動いたら、塗る前に測り
  // 直す。古い座標のままだと別の行の横に残る。`measure` は一覧ごとに作り直される。
  useLayoutEffect(() => {
    reanchor(measure)
  }, [reanchor, measure])

  const onOuterScroll = useCallback(() => scrolled(measure), [scrolled, measure])

  // 行は描き直しを省く（`memo`）ため、親から来る関数の同一性を保つ。
  const latestOnUse = useRef(onUse)
  useEffect(() => {
    latestOnUse.current = onUse
  }, [onUse])
  const use = useCallback((sql: string) => latestOnUse.current(sql), [])

  const openMenu = useCallback(
    (entry: HistoryEntry, x: number, y: number) => {
      closePreview()
      setMenu({ x, y, entry })
    },
    [closePreview],
  )
  // 絞り込みや削除で消えた行のプレビューは出さない。
  const previewed =
    preview.target === null
      ? undefined
      : entries.find((entry) => entry.id === preview.target?.entryId)
  /**
   * 保存できたことを告げる一言（ADR 0041）。
   *
   * 保存済みの一覧は別のセグメントにあって見えないため、ここで告げないと
   * 積めたのかが分からない。寿命がこの一覧と同じなので、ストアへは上げない。
   */
  const [notice, setNotice] = useState<{ name: string } | null>(null)

  useEffect(() => {
    if (notice === null) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const saveQuery = (entry: HistoryEntry) => {
    void onSaveQuery(entry).then((name) => {
      if (name !== null) {
        setNotice({ name })
      }
    })
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-8px gap-y-2px px-9px py-6px">
        <div role="group" aria-label="表示する接続" className="flex gap-2px">
          <ScopeButton active={scope === 'connection'} onClick={() => setScope('connection')}>
            この接続のみ
          </ScopeButton>
          <ScopeButton active={scope === 'all'} onClick={() => setScope('all')}>
            全接続
          </ScopeButton>
        </div>
        <div role="group" aria-label="成否で絞り込む" className="flex gap-2px ml-auto">
          {OUTCOMES.map((option) => (
            <ScopeButton
              key={option.value}
              active={outcome === option.value}
              onClick={() => setOutcome(option.value)}
            >
              {option.label}
            </ScopeButton>
          ))}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`m-0 px-12px text-10.5px text-fg4 truncate ${notice === null ? 'hidden' : 'pb-4px'}`}
      >
        {notice === null ? '' : `「${notice.name}」を保存済みクエリへ追加しました`}
      </p>

      {entries.length === 0 ? (
        <p className="m-0 px-14px py-16px text-12px leading-[1.6] text-fg5 text-center">
          {loading ? '読み込んでいます…' : emptyMessage(outcome)}
        </p>
      ) : (
        <ul ref={listRef} className="list-none m-0 p-0 flex flex-col" onKeyDown={moveRowFocus}>
          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              previewId={previewed?.id === entry.id ? previewId : undefined}
              onUse={use}
              onRemove={remove}
              onContextMenu={openMenu}
              onFocusRow={preview.focusRow}
              onBlurRow={preview.blurRow}
              onEnterRow={preview.enterRow}
              onLeaveRow={preview.leave}
            />
          ))}
        </ul>
      )}
      {previewed !== undefined && preview.target !== null && menu === null ? (
        <HistoryPreview
          id={previewId}
          entry={previewed}
          anchor={preview.target.anchor}
          meta={<EntryMeta entry={previewed} />}
          onPointerEnter={preview.keep}
          onPointerLeave={preview.leave}
          onClose={preview.close}
          onOuterScroll={onOuterScroll}
        />
      ) : null}
      {menu ? (
        <SqlEntryContextMenu
          x={menu.x}
          y={menu.y}
          heading={summarize(menu.entry.sql)}
          onUse={() => onUse(menu.entry.sql)}
          onOpenInNewTab={() => onOpenInNewTab(menu.entry.sql)}
          onCopy={() => void getClipboardApi().writeText(menu.entry.sql)}
          onSaveQuery={() => saveQuery(menu.entry)}
          onRemove={() => remove(menu.entry.id)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

/** 時刻・接続名・成否の 1 行。行とプレビューの見出しで同じ表記にする。 */
function EntryMeta({ entry }: { entry: HistoryEntry }) {
  return (
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
  )
}

/**
 * 行の画面上の位置を取る。
 *
 * @param element 行（`li`）
 */
function anchorOf(element: Element): RowAnchor {
  const rect = element.getBoundingClientRect()
  return { top: rect.top, right: rect.right }
}

interface HistoryRowProps {
  entry: HistoryEntry
  /** この行の全文プレビューを出しているとき、その ID。 */
  previewId: string | undefined
  onUse: (sql: string) => void
  onRemove: (id: number) => void
  /** 右クリックされた。押した点を渡す。 */
  onContextMenu: (entry: HistoryEntry, x: number, y: number) => void
  /** 本体に焦点が当たった。 */
  onFocusRow: (entryId: number, anchor: RowAnchor) => void
  /** 本体から焦点が抜けた。 */
  onBlurRow: (entryId: number) => void
  /** ポインタが行に入った。 */
  onEnterRow: (entryId: number, anchor: RowAnchor) => void
  /** ポインタが行から出た。 */
  onLeaveRow: () => void
}

/**
 * 履歴 1 件。押すとエディタへ入り、✕ で 1 件だけ消える。
 *
 * `memo` で包むのは、ホバーで行を移るたびにプレビューの対象が変わり、包まないと
 * 200 行すべてが時刻と行数の整形ごと描き直るためである。関数の引数は履歴の
 * ID を受け取る形にして、行ごとに関数を作らない。
 */
const HistoryRow = memo(function HistoryRow({
  entry,
  previewId,
  onUse,
  onRemove,
  onContextMenu,
  onFocusRow,
  onBlurRow,
  onEnterRow,
  onLeaveRow,
}: HistoryRowProps) {
  return (
    <li
      className="flex items-start gap-6px px-10px py-6px hover:bg-fill"
      {...{ [ENTRY_ATTRIBUTE]: entry.id }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(entry, event.clientX, event.clientY)
      }}
      onPointerEnter={(event) => onEnterRow(entry.id, anchorOf(event.currentTarget))}
      onPointerLeave={onLeaveRow}
    >
      <button
        type="button"
        {...{ [ROW_ATTRIBUTE]: '' }}
        aria-describedby={previewId}
        onClick={() => onUse(entry.sql)}
        onFocus={(event) => {
          const row = event.currentTarget.closest('li')
          if (row !== null) {
            onFocusRow(entry.id, anchorOf(row))
          }
        }}
        onBlur={() => onBlurRow(entry.id)}
        className="flex-1 min-w-0 flex flex-col gap-3px bg-transparent border-none p-0 cursor-pointer font-inherit text-left"
      >
        <span className="text-11.5px text-fg2 truncate w-full">{summarize(entry.sql)}</span>
        <EntryMeta entry={entry} />
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
})

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
