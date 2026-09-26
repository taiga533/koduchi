/**
 * 結果テーブルの右クリックメニュー。
 *
 * 項目は「コピー」「見出し付きでコピー」「この列をコピー」の 3 つ。編集や貼り付けは
 * 対象外である。セルと行番号の右クリックで出す（行番号は ADR 0038）。
 *
 * 器は共通の `ContextMenu`（ADR 0038）で、焦点を奪わない。閉じた後も焦点は表に
 * 残る。奪うと焦点が `<body>` へ抜け、選択が見えたまま `⌘A` / `⌘C` / 矢印が表へ
 * 届かなくなる（issue #53）。
 */

import { Columns3, Copy, TableProperties } from 'lucide-react'
import { ContextMenu } from '../menu/ContextMenu'

interface ResultContextMenuProps {
  /** 画面上の表示位置（`clientX` / `clientY`）。 */
  x: number
  y: number
  /** 選択範囲をコピーする。 */
  onCopy: () => void
  /** 列見出しを付けて選択範囲をコピーする。 */
  onCopyWithHeader: () => void
  /**
   * 右クリックしたセルの列を丸ごとコピーする。行番号から開いたときは列が
   * 決まらないため省き、項目も出さない。
   */
  onCopyColumn?: () => void
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
  return (
    <ContextMenu
      x={x}
      y={y}
      width={186}
      testId="result-context-menu"
      entries={[
        { kind: 'item', label: 'コピー', icon: <Copy size={13} />, onSelect: onCopy },
        {
          kind: 'item',
          label: '見出し付きでコピー',
          icon: <TableProperties size={13} />,
          onSelect: onCopyWithHeader,
        },
        ...(onCopyColumn
          ? [
              {
                kind: 'item' as const,
                label: 'この列をコピー',
                icon: <Columns3 size={13} />,
                onSelect: onCopyColumn,
              },
            ]
          : []),
      ]}
      onClose={onClose}
    />
  )
}
