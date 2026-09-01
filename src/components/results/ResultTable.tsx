/**
 * 結果テーブル（デザイン 3a の結果ペイン）。
 *
 * TanStack Virtual による仮想スクロールで、行数が多くても描画が破綻しないように
 * する。分割取得（ADR 0003）は実装順の後の段で加える。
 *
 * 行の高さは設定で決まる固定値であり、セルの内容は折り返さない。そのため実寸を
 * 測る必要がなく、見積りをそのまま使える。
 */

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RowHeight } from '../../theme/appearance'
import type { TabExecution } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { columnWidth, displayText, isRightAligned, tableMinWidth } from './cellText'

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

  const template = [
    `${ROW_NUMBER_WIDTH}px`,
    ...execution.columns.map((column) => columnWidth(column.kind)),
  ].join(' ')

  // 見出しと本文は別々のスクロール領域にあるため、同じ最小幅を与えて桁を揃える。
  const minWidth = tableMinWidth(
    execution.columns.map((column) => column.kind),
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
          {execution.columns.map((column) => (
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
