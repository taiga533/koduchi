/**
 * スキーマツリーの右クリックメニュー（ADR 0020・0022）。
 *
 * 作りは結果テーブルの `ResultContextMenu.tsx` に揃えてある。項目は「名前を
 * コピー」「エディタへ挿入」「`SELECT` を開く」「定義を開く」の 4 つ。
 * 3 つめは列を持つ種別（表・ビュー・マテビュー）のとき、4 つめはオブジェクトの
 * 行で繋がっているときだけ出す。
 *
 * **「定義を開く」は末尾に置く。**先に入っていた 3 項目の位置を動かさないため
 * であり、タブが増える重いほうを下へ寄せる並びとも合う（ADR 0022）。
 *
 * 見出しに対象の名前を出す。ツリーは 1 行が細く、右クリックした行を取り違えた
 * まま操作してしまうことがあるためである。
 */

import { Copy, Table2, TableProperties, TextCursorInput } from 'lucide-react'

interface SchemaTreeContextMenuProps {
  /** 画面上の表示位置（`clientX` / `clientY`）。 */
  x: number
  y: number
  /** 見出しに出す、右クリックした行の名前。挿入されるのと同じ綴りである。 */
  target: string
  /** `SELECT` を開けるか。表・ビュー・マテビューのときだけ真。 */
  canSelect: boolean
  /** 定義タブを開けるか。オブジェクトの行で、かつ繋がっているときだけ真。 */
  canOpenDefinition: boolean
  /** 名前をクリップボードへ書く。 */
  onCopy: () => void
  /** 名前をエディタのカーソル位置へ入れる。 */
  onInsert: () => void
  /** `select * from …` を新しいタブに開く。 */
  onOpenSelect: () => void
  /** 定義タブを開く（ADR 0022）。 */
  onOpenDefinition: () => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function SchemaTreeContextMenu({
  x,
  y,
  target,
  canSelect,
  canOpenDefinition,
  onCopy,
  onInsert,
  onOpenSelect,
  onOpenDefinition,
  onClose,
}: SchemaTreeContextMenuProps) {
  return (
    <>
      {/* メニューの外を押したら閉じる。右クリックでも閉じる。 */}
      <div
        data-testid="schema-tree-context-menu-backdrop"
        className="fixed inset-0 z-20"
        onMouseDown={onClose}
        onContextMenu={onClose}
      />
      <div
        role="menu"
        data-testid="schema-tree-context-menu"
        style={{ left: x, top: y }}
        className="fixed z-30 w-200px p-4px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-1px"
      >
        <p className="m-0 px-9px py-4px text-10.5px text-fg5 truncate">{target}</p>
        <MenuItem label="名前をコピー" icon={<Copy size={13} />} onSelect={onCopy} />
        <MenuItem label="エディタへ挿入" icon={<TextCursorInput size={13} />} onSelect={onInsert} />
        {canSelect ? (
          <MenuItem label="SELECT を開く" icon={<Table2 size={13} />} onSelect={onOpenSelect} />
        ) : null}
        {canOpenDefinition ? (
          <MenuItem
            label="定義を開く"
            icon={<TableProperties size={13} />}
            onSelect={onOpenDefinition}
          />
        ) : null}
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
