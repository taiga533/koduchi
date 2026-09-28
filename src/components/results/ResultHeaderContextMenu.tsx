/**
 * 結果テーブルの列見出しの右クリックメニュー（ADR 0038）。
 *
 * 項目は「列名をコピー」「この列をコピー」「列幅を内容に合わせる」の 3 つ。
 * 列名だけが欲しい場面（`WHERE` を書き足すなど）は多いが、見出しから取る道が
 * 無かった。「この列をコピー」はセルのメニューと、幅合わせは見出しの
 * ダブルクリックと同じ動きである。
 *
 * **選択は動かさない。**見出しは選択の単位ではない（ADR README「結果テーブル」）。
 *
 * 列の固定（ADR 0048）の「この列まで固定」「列の固定を解除」もここに置く。固定は
 * 列の単位の操作であり、入口を見出しに寄せる。どちらも押しても意味の無いときは
 * 出さない（既にその列までを固定している／何も固定していない）。
 */

import { Columns3, Copy, MoveHorizontal, Pin, PinOff } from 'lucide-react'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu, SEPARATOR } from '../menu/ContextMenu'

interface ResultHeaderContextMenuProps {
  x: number
  y: number
  /** 見出しに出す列名。 */
  columnName: string
  onCopyName: () => void
  onCopyColumn: () => void
  onFit: () => void
  /** この列までを固定する。既にこの列までを固定していれば `undefined`。 */
  onFreeze?: () => void
  /** 列の固定を解除する。何も固定していなければ `undefined`。 */
  onUnfreeze?: () => void
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
  onFreeze,
  onUnfreeze,
  onClose,
}: ResultHeaderContextMenuProps) {
  const freezing: ContextMenuEntry[] = [
    ...(onFreeze
      ? [
          {
            kind: 'item' as const,
            label: 'この列まで固定',
            icon: <Pin size={13} />,
            onSelect: onFreeze,
          },
        ]
      : []),
    ...(onUnfreeze
      ? [
          {
            kind: 'item' as const,
            label: '列の固定を解除',
            icon: <PinOff size={13} />,
            onSelect: onUnfreeze,
          },
        ]
      : []),
  ]
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
        ...(freezing.length > 0 ? [SEPARATOR, ...freezing] : []),
      ]}
      onClose={onClose}
    />
  )
}
