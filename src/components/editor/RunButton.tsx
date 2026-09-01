/**
 * 実行ボタン（デザイン 3a の右下に浮くボタン）。
 *
 * 通常は「実行」と `▾` の 2 つ割りで、`▾` から実行にまつわるメニューを開く。
 * 実行中は「中止」1 つに入れ替わる（デザイン 5a）。
 *
 * メニューの項目と押しキーは ADR の「キーバインド」節と対応している。ここは
 * その入口を目に見える形で置くだけで、実際の処理は呼び出し側にある。
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface RunButtonProps {
  /** 実行中か。真なら「中止」になる。 */
  running: boolean
  /** `⌘⏎`。カーソル位置の文を実行する。 */
  onRun: () => void
  /** `⇧⌘⏎`。選択範囲を実行する。選択が無ければ押せない。 */
  onRunSelection: () => void
  /** 選択範囲があるか。 */
  hasSelection: boolean
  /** `⌘E`。見積りの実行計画を生成する。 */
  onExplain: () => void
  /** `⇧⌘E`。実測付きの実行計画を生成する。 */
  onExplainActual: () => void
  /** `⌥⌘S`。結果を CSV で保存する。 */
  onSaveCsv: () => void
  /** `⌘.`。実行を中止する。 */
  onCancel: () => void
}

export function RunButton({
  running,
  onRun,
  onRunSelection,
  hasSelection,
  onExplain,
  onExplainActual,
  onSaveCsv,
  onCancel,
}: RunButtonProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  // メニューの外を押したら閉じる。ボタン自身の押下は下の onClick が先に走る。
  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (running) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="absolute bottom-11px right-12px flex items-center gap-7px px-14px py-6px rounded-8px bg-panel border border-line text-12.5px font-600 text-fg cursor-pointer font-inherit shadow-[0_5px_14px_-3px_rgba(24,28,38,.24)]"
      >
        中止
      </button>
    )
  }

  /** メニューの項目を押したときの共通処理。閉じてから実行する。 */
  const pick = (work: () => void) => {
    setOpen(false)
    work()
  }

  return (
    <div ref={container} className="absolute bottom-11px right-12px">
      {open ? (
        <div className="absolute bottom-40px right-0 w-282px p-5px rounded-9px bg-panel border border-line shadow-[0_14px_30px_-10px_rgba(24,28,38,.36)] text-12.5px">
          <MenuItem shortcut="⌘⏎" onClick={() => pick(onRun)}>
            実行
          </MenuItem>
          <MenuItem shortcut="⇧⌘⏎" disabled={!hasSelection} onClick={() => pick(onRunSelection)}>
            選択範囲のみ実行
          </MenuItem>
          <Divider />
          <MenuItem shortcut="⌘E" note="EXPLAIN" onClick={() => pick(onExplain)}>
            実行計画を生成
          </MenuItem>
          <MenuItem shortcut="⇧⌘E" note="ANALYZE" onClick={() => pick(onExplainActual)}>
            実測付きで生成
          </MenuItem>
          <Divider />
          <MenuItem shortcut="⌥⌘S" onClick={() => pick(onSaveCsv)}>
            結果を CSV で保存
          </MenuItem>
        </div>
      ) : null}

      <div className="flex items-stretch rounded-8px overflow-hidden shadow-[0_5px_14px_-3px_rgba(24,28,38,.32)] text-12.5px font-600">
        <button
          type="button"
          onClick={onRun}
          className="flex items-center px-14px py-6px bg-ac text-acfg border-none cursor-pointer font-inherit text-12.5px font-600"
        >
          実行
        </button>
        <span className="w-1px bg-acdiv" />
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label="実行のメニュー"
          aria-expanded={open}
          className="flex items-center px-9px bg-ac text-acfg border-none cursor-pointer font-inherit"
        >
          <ChevronDown size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

/** メニューの 1 項目。 */
function MenuItem({
  shortcut,
  note,
  disabled,
  onClick,
  children,
}: {
  shortcut: string
  note?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-10px px-9px py-6px rounded-6px bg-transparent border-none cursor-pointer font-inherit text-12.5px text-left text-fg hover:bg-fill2 disabled:opacity-40 disabled:cursor-default"
    >
      <span className="flex-1">
        {children}
        {note ? <span className="text-fg4 text-11px"> {note}</span> : null}
      </span>
      <span className="text-10.5px text-fg5">{shortcut}</span>
    </button>
  )
}

/** メニューの区切り線。 */
function Divider() {
  return <div className="h-1px mx-6px my-4px bg-line2" />
}
