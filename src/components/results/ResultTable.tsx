/**
 * 結果テーブル（デザイン 3a の結果ペイン）。
 *
 * TanStack Virtual による仮想スクロールで、行数が多くても描画が破綻しないように
 * する。スクロールが下端に近づくたびに 1,000 行ずつ追加取得する（ADR 0003）。
 *
 * 行の高さは設定で決まる固定値であり、セルの内容は折り返さない。そのため実寸を
 * 測る必要がなく、見積りをそのまま使える。
 *
 * セル選択とコピーはこのコンポーネントの中に閉じる。選択を `ui` ストアへ置くと
 * 矢印キーの打鍵ごとにアプリ全体が描き直るためである。タブを切り替えたときは
 * `ResultPane` が `key` を変えて作り直すので、選択はその場で捨てられる。
 *
 * マウスの操作は場所と回数で割り振ってあり、互いに食い合わない。
 *
 * | 操作                   | 起きること                       |
 * | ---------------------- | -------------------------------- |
 * | セルを単クリック       | そのセルを選ぶ（ドラッグで矩形） |
 * | セルをダブルクリック   | 詳細パネルを開く                 |
 * | セルを右クリック       | コピーのメニュー                 |
 * | 行番号を単クリック     | 行全体を選ぶ                     |
 * | 見出しの右端をドラッグ | 列幅を変える                     |
 * | 見出しをダブルクリック | 列幅を内容に合わせる             |
 *
 * 列幅の勘定は `columnSizing.ts`、詳細パネルは `CellDetailPanel.tsx` にある。
 * 列の並べ替え（ソート）は実装しない。分割取得のため、取得済みの行だけを並べ替
 * えると全体を並べ替えたように見えて嘘になる（ADR README の「結果テーブル」節）。
 */

import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getClipboardApi } from '../../api/clipboard'
import type { Column } from '../../types/db'
import type { RowHeight } from '../../theme/appearance'
import type { TabExecution } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { displayText, isRightAligned } from './cellText'
import type { ColumnWidths } from './columnSizing'
import {
  autoFitWidth,
  clampColumnWidth,
  columnMinWidthOf,
  gridTemplate,
  resolveTableMinWidth,
} from './columnSizing'
import { CellDetailPanel } from './CellDetailPanel'
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

/** 幅を決めていないタブで使う空の対応表。参照を固定して再描画を防ぐ。 */
const NO_WIDTHS: ColumnWidths = {}

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

/** 詳細パネルに出しているセルの位置。 */
interface DetailTarget {
  row: number
  column: number
}

interface ResultTableProps {
  /** 結果を持つエディタタブの ID。列幅を覚えるキーになる。 */
  tabId: string | null
  execution: TabExecution
  /** 続きのかたまりを要求する。カーソルが尽きていれば呼ばれない。 */
  onRequestMore: () => void
}

export function ResultTable({ tabId, execution, onRequestMore }: ResultTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rowHeightSetting = useUiStore((state) => state.appearance.rowHeight)
  const rowHeight = ROW_HEIGHTS[rowHeightSetting]

  const widths = useUiStore(
    (state) => (tabId === null ? undefined : state.resultColumnWidths[tabId]) ?? NO_WIDTHS,
  )
  const setColumnWidth = useUiStore((state) => state.setResultColumnWidth)

  const [selection, setSelection] = useState<CellSelection | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
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

  // 実行し直すと列が入れ替わる。古い選択と詳細は意味を失うため捨てる。列幅は
  // 列名をキーに `ui` ストアが持っており、同じ列名なら保たれるので触らない。
  useEffect(() => {
    setSelection(null)
    setMenu(null)
    setDetail(null)
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
  const openMenu = useCallback((event: ReactMouseEvent, row: number, column: number) => {
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

  const template = gridTemplate(columns, widths, ROW_NUMBER_WIDTH)

  // 見出しと本文は別々のスクロール領域にあるため、同じ最小幅を与えて桁を揃える。
  const minWidth = resolveTableMinWidth(columns, widths, ROW_NUMBER_WIDTH)

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

  /**
   * 列幅を覚える。
   *
   * タブが決まっていないときは覚え先が無いので何もしない。
   */
  const rememberWidth = useCallback(
    (columnName: string, width: number) => {
      if (tabId === null) {
        return
      }
      setColumnWidth(tabId, columnName, clampColumnWidth(width))
    },
    [setColumnWidth, tabId],
  )

  /**
   * 取得済みの行に合わせて列幅を詰める（見出しのダブルクリック）。
   *
   * 走査するのはストアに溜まっている行だけである。まだ取り出していない行の値は
   * 分からないため、続きを読み込んでからもう一度合わせ直すことになる。
   */
  const fitColumn = (column: Column, columnIndex: number) => {
    const values = rows.map((row) => {
      const cell = row[columnIndex]
      return cell === undefined ? '' : displayText(cell)
    })
    rememberWidth(column.name, autoFitWidth(column.name, values))
  }

  /** 詳細パネルに出す列とセル。行が入れ替わって消えていれば `null`。 */
  const detailTarget = useMemo(() => {
    if (detail === null) {
      return null
    }
    const column = columns[detail.column]
    const cell = rows[detail.row]?.[detail.column]
    if (column === undefined || cell === undefined) {
      return null
    }
    return { column, cell, rowNumber: detail.row + 1 }
  }, [columns, detail, rows])

  const closeDetail = useCallback(() => setDetail(null), [])

  const range = selection ? selectionRange(selection) : null

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden text-11.5px">
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
            {columns.map((column, columnIndex) => (
              <ColumnHeader
                key={column.name}
                column={column}
                width={widths[column.name]}
                onResize={(width) => rememberWidth(column.name, width)}
                onFit={() => fitColumn(column, columnIndex)}
              />
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
                      const selected = range
                        ? isSelected(range, virtualRow.index, cellIndex)
                        : false
                      return (
                        <div
                          key={columns[cellIndex]?.name ?? cellIndex}
                          data-testid={`result-cell-${virtualRow.index}-${cellIndex}`}
                          data-selected={selected ? 'true' : undefined}
                          onMouseDown={(event) =>
                            beginSelect(virtualRow.index, cellIndex, event.shiftKey)
                          }
                          onMouseEnter={() => extendSelect(virtualRow.index, cellIndex)}
                          onDoubleClick={() =>
                            setDetail({ row: virtualRow.index, column: cellIndex })
                          }
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
      </div>

      {detailTarget === null ? null : (
        <CellDetailPanel
          column={detailTarget.column}
          cell={detailTarget.cell}
          rowNumber={detailTarget.rowNumber}
          onClose={closeDetail}
        />
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

interface ColumnHeaderProps {
  column: Column
  /** 覚えている幅。無ければ型ごとの既定で描かれている。 */
  width: number | undefined
  /** ドラッグ中の幅を伝える。 */
  onResize: (width: number) => void
  /** 内容に合わせる（ダブルクリック）。 */
  onFit: () => void
}

/**
 * 列見出し 1 つ。右端に幅を変えるためのつまみを持つ。
 *
 * つまみの当たり判定は 6px。ドラッグ中はウィンドウ全体で `mousemove` を拾うため、
 * ポインタが見出しの外へ出ても幅が追従する。押し下げを拾う場所が本文のセルとは
 * 分かれているため、セル選択のドラッグとは食い合わない。
 */
function ColumnHeader({ column, width, onResize, onFit }: ColumnHeaderProps) {
  const cellRef = useRef<HTMLDivElement>(null)

  const beginResize = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    const startX = event.clientX
    // 覚えている幅が無ければ実際に描かれている幅から始める。jsdom のように寸法を
    // 持たない環境では 0 が返るため、型ごとの既定へ落とす。
    const measured = cellRef.current?.getBoundingClientRect().width ?? 0
    const startWidth = width ?? (measured > 0 ? measured : columnMinWidthOf(column))

    const onMove = (moveEvent: MouseEvent) => {
      onResize(startWidth + moveEvent.clientX - startX)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={cellRef}
      title={`${column.name} ${column.typeName}`}
      onDoubleClick={onFit}
      className={`relative px-9px py-5px border-r border-line2 truncate ${
        isRightAligned(column.kind) ? 'text-right' : ''
      }`}
    >
      {column.name}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`${column.name} の列幅を変える`}
        onMouseDown={beginResize}
        className="absolute top-0 right-0 w-6px h-full cursor-col-resize"
      />
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
