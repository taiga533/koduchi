/**
 * 結果テーブルの右クリックメニュー。
 *
 * 項目は「コピー」「見出し付きでコピー」「この列をコピー」の 3 つ。編集や貼り付けは
 * 対象外である。
 */

import { Columns3, Copy, TableProperties } from 'lucide-react'
import { useEscapeKey } from '../../input/useEscapeKey'

interface ResultContextMenuProps {
  /** 画面上の表示位置（`clientX` / `clientY`）。 */
  x: number
  y: number
  /** 選択範囲をコピーする。 */
  onCopy: () => void
  /** 列見出しを付けて選択範囲をコピーする。 */
  onCopyWithHeader: () => void
  /** 右クリックしたセルの列を丸ごとコピーする。 */
  onCopyColumn: () => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function ResultContextMenu({
  x,
  y,
  onCopy,
  onCopyWithHeader,
  onCopyColumn,
  onClose,
}: ResultContextMenuProps) {
  // `esc` で閉じる。打鍵は器ではなく `window` で受ける（ADR 0031）。
  useEscapeKey(onClose)

  return (
    <>
      {/* メニューの外を押したら閉じる。右クリックでも閉じる。 */}
      <div
        data-testid="result-context-menu-backdrop"
        className="fixed inset-0 z-20"
        onMouseDown={onClose}
        onContextMenu={onClose}
      />
      <div
        role="menu"
        data-testid="result-context-menu"
        style={{ left: x, top: y }}
        className="fixed z-30 w-186px p-4px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-1px"
      >
        <MenuItem label="コピー" icon={<Copy size={13} />} onSelect={onCopy} />
        <MenuItem
          label="見出し付きでコピー"
          icon={<TableProperties size={13} />}
          onSelect={onCopyWithHeader}
        />
        <MenuItem label="この列をコピー" icon={<Columns3 size={13} />} onSelect={onCopyColumn} />
      </div>
    </>
  )
}

interface MenuItemProps {
  label: string
  icon: React.ReactNode
  onSelect: () => void
}

/** メニューの 1 項目。 */
function MenuItem({ label, icon, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-8px px-9px py-5px rounded-6px bg-transparent border-none cursor-pointer font-inherit text-11.5px text-fg text-left hover:bg-fill"
    >
      <span className="text-fg4 flex items-center">{icon}</span>
      {label}
    </button>
  )
}
