/**
 * 結果テーブルの列見出しの右クリックメニュー（ADR 0038）。
 *
 * 項目は「列名をコピー」「この列をコピー」「列幅を内容に合わせる」の 3 つ。
 * 列名だけが欲しい場面（`WHERE` を書き足すなど）は多いが、見出しから取る道が
 * 無かった。「この列をコピー」はセルのメニューと、幅合わせは見出しの
 * ダブルクリックと同じ動きである。
 *
 * **選択は動かさない。**見出しは選択の単位ではない（ADR README「結果テーブル」）。
 */

import { Columns3, Copy, MoveHorizontal } from 'lucide-react'
import { ContextMenu } from '../menu/ContextMenu'

interface ResultHeaderContextMenuProps {
  x: number
  y: number
  /** 見出しに出す列名。 */
  columnName: string
  onCopyName: () => void
  onCopyColumn: () => void
  onFit: () => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function ResultHeaderContextMenu({
  x,
  y,
  columnName,
  onCopyName,
  onCopyColumn,
  onFit,
  onClose,
}: ResultHeaderContextMenuProps) {
  return (
    <ContextMenu
      x={x}
      y={y}
      heading={columnName}
      width={200}
      testId="result-header-context-menu"
      entries={[
        { kind: 'item', label: '列名をコピー', icon: <Copy size={13} />, onSelect: onCopyName },
        {
          kind: 'item',
          label: 'この列をコピー',
          icon: <Columns3 size={13} />,
          onSelect: onCopyColumn,
        },
        {
          kind: 'item',
          label: '列幅を内容に合わせる',
          icon: <MoveHorizontal size={13} />,
          onSelect: onFit,
        },
      ]}
      onClose={onClose}
    />
  )
}
