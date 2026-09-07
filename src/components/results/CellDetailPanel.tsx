/**
 * セルの詳細パネル。
 *
 * 結果テーブルの右側に開き、セルの全文を等幅で出す。テーブルを隠さないため、
 * 値を読みながら別の行へ移れる。折り返しと JSON の整形は切り替えられる。
 * `esc` で閉じる。
 */

import { useEffect, useState } from 'react'
import { WrapText, X } from 'lucide-react'
import type { Cell, Column } from '../../types/db'
import { characterCount, detailBody, formatJson, isOpaque } from './cellDetail'

interface CellDetailPanelProps {
  column: Column
  cell: Cell
  /** 1 始まりの行番号。どの行を見ているかを示す。 */
  rowNumber: number
  onClose: () => void
}

export function CellDetailPanel({ column, cell, rowNumber, onClose }: CellDetailPanelProps) {
  const [wrap, setWrap] = useState(true)
  const [formatted, setFormatted] = useState(true)

  // `esc` で閉じる。パネルは focus を奪わないため、ウィンドウ側で受ける。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const body = detailBody(cell, formatted)
  // 整形の切替を出すのは、実際に JSON として読めた値だけにする。
  const jsonAvailable = formatJson(cell.text) !== null

  return (
    <aside
      data-testid="cell-detail-panel"
      aria-label="セルの詳細"
      className="w-320px shrink-0 flex flex-col min-h-0 bg-panel2 border-l border-line"
    >
      <div className="flex items-center gap-6px px-10px h-32px shrink-0 border-b border-line2">
        <span className="flex-1 min-w-0 truncate text-12px font-600 text-fg">{column.name}</span>
        <button
          type="button"
          onClick={() => setWrap((current) => !current)}
          aria-label="折り返しを切り替える"
          aria-pressed={wrap}
          className={`flex items-center bg-transparent border-none p-2px rounded-4px cursor-pointer font-inherit ${
            wrap ? 'text-ac' : 'text-fg4'
          }`}
        >
          <WrapText size={14} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="詳細を閉じる"
          className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
        >
          <X size={15} />
        </button>
      </div>

      <div className="px-10px py-7px shrink-0 flex flex-col gap-4px text-10.5px text-fg4 border-b border-line2">
        <span>
          {rowNumber} 行目 · {column.typeName}
        </span>
        <span>
          {cell.kind === 'null'
            ? '値なし（NULL）'
            : `${characterCount(cell.text).toLocaleString('ja-JP')} 文字`}
        </span>
      </div>

      {jsonAvailable ? (
        <label className="px-10px py-6px shrink-0 flex items-center gap-6px text-11px text-fg3 cursor-pointer border-b border-line2">
          <input
            type="checkbox"
            checked={formatted}
            onChange={(event) => setFormatted(event.target.checked)}
          />
          JSON として整形する
        </label>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto select-text px-10px py-9px">
        {isOpaque(cell) ? (
          <p className="m-0 text-11.5px text-fg4 leading-[1.6]">
            {cell.text} の中身は取得していません。大きさだけを表示しています。
          </p>
        ) : (
          <pre
            data-testid="cell-detail-body"
            className={`m-0 text-11.5px leading-[1.6] text-fg2 ${
              wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            {body}
          </pre>
        )}
      </div>
    </aside>
  )
}
