/**
 * 結果テーブル（デザイン 3a の結果ペイン）。
 *
 * TanStack Virtual による仮想スクロールで、行数が多くても描画が破綻しないように
 * する。分割取得（ADR 0003）は実装順の後の段で加える。
 *
 * 行の高さは設定で決まる固定値であり、セルの内容は折り返さない。そのため実寸を
 * 測る必要がなく、見積りをそのまま使える。
 *
 * セル選択とコピーはこのコンポーネントの中に閉じる。選択を `ui` ストアへ置くと
 * 矢印キーの打鍵ごとにアプリ全体が描き直るためである。タブを切り替えたときは
 * `ResultPane` が `key` を変えて作り直すので、選択はその場で捨てられる。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getClipboardApi } from '../../api/clipboard'
import type { RowHeight } from '../../theme/appearance'
import type { TabExecution } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { columnWidth, displayText, isRightAligned, tableMinWidth } from './cellText'
import { ResultContextMenu } from './ResultContextMenu'
import type { CellSelection, SelectionRange } from './selection'
import {
  buildCopyText,
  columnSelection,
  isMoveKey,
  isSelected,
  moveSelection,
  rowSelection,
  selectAll,
  selectionEdges,
  selectionRange,
  selectionShadow,
} from './selection'

/** 行番号を出す先頭列の幅（ピクセル）。 */
const ROW_NUMBER_WIDTH = 44

/**
 * 行の高さ（ピクセル）。
 *
 * `tokens.css` の `--rp`（行のパディング）と対応する。上下のパディングに
 * 11.5px の文字 1 行ぶんを足した値。
 */
const ROW_HEIGHTS: Record<RowHeight, number> = {
  compact: 23,
  comfortable: 31,
}

/**
 * 続きを取りにいく残り行数のしきい値。
 *
 * 描画済みの末尾がこの行数以内に近づいたら、次のかたまりを要求する（ADR 0003）。
 */
const FETCH_MORE_THRESHOLD = 200

/** 右クリックメニューの開いている位置と、押されたセルの列。 */
interface ContextMenuState {
  x: number
  y: number
  column: number
}

interface ResultTableProps {
  execution: TabExecution
  /** 続きのかたまりを要求する。カーソルが尽きていれば呼ばれない。 */
  onRequestMore: () => void
}

export function ResultTable({ execution, onRequestMore }: ResultTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rowHeightSetting = useUiStore((state) => state.appearance.rowHeight)
  const rowHeight = ROW_HEIGHTS[rowHeightSetting]

  const [selection, setSelection] = useState<CellSelection | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  /** ドラッグ中か。押し下げから離すまでの間だけ真になる。 */
  const draggingRef = useRef(false)

  const rowCount = execution.rows.length
  const columnCount = execution.columns.length
  const columns = execution.columns
  const rows = execution.rows

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.at(-1)?.index ?? 0

  // 下端に近づいたら次のかたまりを取りにいく。
  useEffect(() => {
    if (execution.exhausted || execution.loadingMore) {
      return
    }
    if (rowCount - lastVisibleIndex <= FETCH_MORE_THRESHOLD) {
      onRequestMore()
    }
  }, [execution.exhausted, execution.loadingMore, rowCount, lastVisibleIndex, onRequestMore])

  // 実行し直すと列が入れ替わる。古い選択は意味を失うため捨てる。
  useEffect(() => {
    setSelection(null)
    setMenu(null)
  }, [columns])

  // 選択が画面の外へ出たら追いかける（仮想スクロールのため自動では見えない）。
  const focusRow = selection?.focus.row
  useEffect(() => {
    if (focusRow !== undefined) {
      virtualizer.scrollToIndex(focusRow)
    }
  }, [focusRow, virtualizer])

  // ドラッグはテーブルの外で離されることもあるため、窓全体で終わりを拾う。
  useEffect(() => {
    const stop = () => {
      draggingRef.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  /**
   * 選択範囲をクリップボードへ載せる。
   *
   * @param range コピーする範囲
   * @param withHeader 列見出しを 1 行目に付けるか
   */
  const copyRange = useCallback(
    (range: SelectionRange, withHeader: boolean) => {
      const text = buildCopyText(columns, rows, range, withHeader)
      void getClipboardApi().writeText(text)
    },
    [columns, rows],
  )

  /**
   * セルの押し下げで選択を始める。
   *
   * `⇧` を伴うときは `anchor` を据え置いて範囲を伸ばす。
   *
   * @param row 行番号
   * @param column 列番号
   * @param extend `⇧` を伴うか
   */
  const beginSelect = useCallback((row: number, column: number, extend: boolean) => {
    draggingRef.current = true
    setSelection((current) =>
      extend && current
        ? { anchor: current.anchor, focus: { row, column } }
        : { anchor: { row, column }, focus: { row, column } },
    )
  }, [])

  /** ドラッグ中にセルへ入ったら選択を伸ばす。 */
  const extendSelect = useCallback((row: number, column: number) => {
    if (!draggingRef.current) {
      return
    }
    setSelection((current) => (current ? { anchor: current.anchor, focus: { row, column } } : null))
  }, [])

  /** 行番号の列を押したら行全体を選ぶ。`⇧` を伴えば行の範囲になる。 */
  const selectRow = useCallback(
    (row: number, extend: boolean) => {
      draggingRef.current = true
      setSelection((current) =>
        extend && current
          ? { anchor: current.anchor, focus: { row, column: Math.max(columnCount - 1, 0) } }
          : rowSelection(row, columnCount),
      )
    },
    [columnCount],
  )

  /**
   * 右クリックでメニューを開く。
   *
   * 選択の外を押したときはそのセル 1 つを選び直す。選択の中ならその範囲を保つ。
   *
   * @param event 発生したイベント
   * @param row 行番号
   * @param column 列番号
   */
  const openMenu = useCallback((event: React.MouseEvent, row: number, column: number) => {
    event.preventDefault()
    setSelection((current) =>
      current && isSelected(selectionRange(current), row, column)
        ? current
        : { anchor: { row, column }, focus: { row, column } },
    )
    setMenu({ x: event.clientX, y: event.clientY, column })
  }, [])

  /** テーブルに焦点があるときのキー操作。 */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (rowCount === 0 || columnCount === 0) {
        return
      }

      if (event.metaKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelection(selectAll(rowCount, columnCount))
        return
      }

      if (event.metaKey && event.key.toLowerCase() === 'c') {
        if (!selection) {
          return
        }
        event.preventDefault()
        copyRange(selectionRange(selection), event.shiftKey)
        return
      }

      if (isMoveKey(event.key)) {
        event.preventDefault()
        setSelection((current) =>
          moveSelection(
            current ?? { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
            event.key as Parameters<typeof moveSelection>[1],
            event.shiftKey,
            rowCount,
            columnCount,
          ),
        )
      }
    },
    [columnCount, copyRange, rowCount, selection],
  )

  const template = [
    `${ROW_NUMBER_WIDTH}px`,
    ...columns.map((column) => columnWidth(column.kind)),
  ].join(' ')

  // 見出しと本文は別々のスクロール領域にあるため、同じ最小幅を与えて桁を揃える。
  const minWidth = tableMinWidth(
    columns.map((column) => column.kind),
    ROW_NUMBER_WIDTH,
  )

  /**
   * 本文の横スクロールに見出しを追従させる。
   *
   * 見出しを本文と同じスクロール領域に入れると、仮想スクロールの位置計算に
   * 見出しの高さぶんのずれが入る。位置計算はそのままに、横方向だけを写す。
   */
  const syncHeaderScroll = () => {
    if (headerRef.current && scrollRef.current) {
      headerRef.current.scrollLeft = scrollRef.current.scrollLeft
    }
  }

  const range = selection ? selectionRange(selection) : null

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-11.5px">
      <div
        ref={headerRef}
        data-testid="result-table-header"
        className="overflow-hidden shrink-0 bg-panel2 border-b border-line"
      >
        <div
          className="grid text-10.5px tracking-0.03em text-fg3"
          style={{ gridTemplateColumns: template, minWidth }}
        >
          <div className="px-9px py-5px text-right border-r border-line2" />
          {columns.map((column) => (
            <div
              key={column.name}
              title={`${column.name} ${column.typeName}`}
              className={`px-9px py-5px border-r border-line2 truncate ${
                isRightAligned(column.kind) ? 'text-right' : ''
              }`}
            >
              {column.name}
            </div>
          ))}
        </div>
      </div>

      {rowCount === 0 ? (
        <EmptyRows />
      ) : (
        <div
          ref={scrollRef}
          data-testid="result-table-body"
          tabIndex={0}
          onScroll={syncHeaderScroll}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-0 overflow-auto select-none outline-none"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  className="grid absolute left-0 w-full border-b border-gl text-fg"
                  style={{
                    gridTemplateColumns: template,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    data-testid={`result-row-number-${virtualRow.index}`}
                    onMouseDown={(event) => selectRow(virtualRow.index, event.shiftKey)}
                    className="text-right text-fg6 border-r border-gl bg-panel2 cursor-pointer"
                    style={{ padding: 'var(--rp)' }}
                  >
                    {virtualRow.index + 1}
                  </div>
                  {row.map((cell, cellIndex) => {
                    const edges = range
                      ? selectionEdges(range, virtualRow.index, cellIndex)
                      : { top: false, right: false, bottom: false, left: false }
                    const selected = range ? isSelected(range, virtualRow.index, cellIndex) : false
                    return (
                      <div
                        key={columns[cellIndex]?.name ?? cellIndex}
                        data-testid={`result-cell-${virtualRow.index}-${cellIndex}`}
                        data-selected={selected ? 'true' : undefined}
                        onMouseDown={(event) =>
                          beginSelect(virtualRow.index, cellIndex, event.shiftKey)
                        }
                        onMouseEnter={() => extendSelect(virtualRow.index, cellIndex)}
                        onContextMenu={(event) => openMenu(event, virtualRow.index, cellIndex)}
                        className={`border-r border-gl truncate ${
                          isRightAligned(cell.kind) ? 'text-right' : ''
                        } ${cell.kind === 'null' ? 'text-fg5 italic' : ''} ${
                          selected ? 'bg-fill' : ''
                        }`}
                        style={{ padding: 'var(--rp)', boxShadow: selectionShadow(edges) }}
                        title={displayText(cell)}
                      >
                        {displayText(cell)}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {menu ? (
        <ResultContextMenu
          x={menu.x}
          y={menu.y}
          onCopy={() => {
            if (range) {
              copyRange(range, false)
            }
            setMenu(null)
          }}
          onCopyWithHeader={() => {
            if (range) {
              copyRange(range, true)
            }
            setMenu(null)
          }}
          onCopyColumn={() => {
            copyRange(selectionRange(columnSelection(menu.column, rowCount)), false)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * 0 行のときの表示（デザイン 5c）。
 *
 * 列見出しは残したまま、本文だけを空状態に差し替える。
 */
function EmptyRows() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-9px">
      <p className="text-13px text-fg m-0">一致する行がありません</p>
      <p className="text-12px text-fg4 text-center leading-[1.6] w-344px m-0">
        WHERE 条件を緩めるか、履歴から別の条件を試してください
      </p>
    </div>
  )
}
