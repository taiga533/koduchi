/**
 * 結果テーブル（デザイン 3a の結果ペイン）。
 *
 * TanStack Virtual による仮想スクロールで、行数が多くても描画が破綻しないように
 * する。スクロールが下端に近づくたびに 1,000 行ずつ追加取得する（ADR 0003）。
 *
 * 行の高さは設定で決まる固定値であり、セルの内容は折り返さない。そのため実寸を
 * 測る必要がなく、見積りをそのまま使える。
 *
 * 列幅は見出しの右端をドラッグして変えられ、見出しをダブルクリックすると取得済み
 * の行に合わせて詰まる（`columnSizing.ts`）。セルをダブルクリックすると右側に
 * 詳細パネルが開き、切り詰められた全文を読める（`CellDetailPanel.tsx`）。
 *
 * 列の並べ替え（ソート）は実装しない。結果は 1,000 行ずつの分割取得であり、
 * 取得済みの行だけを並べ替えると「全体を並べ替えた」ように見えて嘘になるためで
 * ある（ADR README の「結果テーブル」節）。
 */

import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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

/** 詳細パネルに出しているセルの位置。 */
interface CellPosition {
  rowIndex: number
  columnIndex: number
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
  const [selected, setSelected] = useState<CellPosition | null>(null)

  const virtualizer = useVirtualizer({
    count: execution.rows.length,
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
    if (execution.rows.length - lastVisibleIndex <= FETCH_MORE_THRESHOLD) {
      onRequestMore()
    }
  }, [
    execution.exhausted,
    execution.loadingMore,
    execution.rows.length,
    lastVisibleIndex,
    onRequestMore,
  ])

  const template = gridTemplate(execution.columns, widths, ROW_NUMBER_WIDTH)

  // 見出しと本文は別々のスクロール領域にあるため、同じ最小幅を与えて桁を揃える。
  const minWidth = resolveTableMinWidth(execution.columns, widths, ROW_NUMBER_WIDTH)

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
    const values = execution.rows.map((row) => {
      const cell = row[columnIndex]
      return cell === undefined ? '' : displayText(cell)
    })
    rememberWidth(column.name, autoFitWidth(column.name, values))
  }

  const selectedCell = useMemo(() => {
    if (selected === null) {
      return null
    }
    const column = execution.columns[selected.columnIndex]
    const cell = execution.rows[selected.rowIndex]?.[selected.columnIndex]
    if (column === undefined || cell === undefined) {
      return null
    }
    return { column, cell, rowNumber: selected.rowIndex + 1 }
  }, [execution.columns, execution.rows, selected])

  const closeDetail = useCallback(() => setSelected(null), [])

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
            {execution.columns.map((column, columnIndex) => (
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

        {execution.rows.length === 0 ? (
          <EmptyRows />
        ) : (
          <div
            ref={scrollRef}
            data-testid="result-table-body"
            onScroll={syncHeaderScroll}
            className="flex-1 min-h-0 overflow-auto select-text"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
              {virtualItems.map((virtualRow) => {
                const row = execution.rows[virtualRow.index]
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
                      className="text-right text-fg6 border-r border-gl bg-panel2"
                      style={{ padding: 'var(--rp)' }}
                    >
                      {virtualRow.index + 1}
                    </div>
                    {row.map((cell, cellIndex) => (
                      <div
                        key={execution.columns[cellIndex]?.name ?? cellIndex}
                        onDoubleClick={() =>
                          setSelected({ rowIndex: virtualRow.index, columnIndex: cellIndex })
                        }
                        className={`border-r border-gl truncate ${
                          isRightAligned(cell.kind) ? 'text-right' : ''
                        } ${cell.kind === 'null' ? 'text-fg5 italic' : ''}`}
                        style={{ padding: 'var(--rp)' }}
                        title={displayText(cell)}
                      >
                        {displayText(cell)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {selectedCell === null ? null : (
        <CellDetailPanel
          column={selectedCell.column}
          cell={selectedCell.cell}
          rowNumber={selectedCell.rowNumber}
          onClose={closeDetail}
        />
      )}
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
 * ポインタが見出しの外へ出ても幅が追従する。
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
