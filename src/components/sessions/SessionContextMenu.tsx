/**
 * セッションとロックの行の右クリックメニュー（ADR 0038）。
 *
 * 項目は「`SID,SERIAL#` をコピー」「行をコピー」の 2 つ。**kill は置かない。**
 * 取り返しの付かない操作を、押したことが分かりにくい右クリックへ置かない
 * （ADR 0020 が `SELECT` の実行を右クリックに置かなかったのと同じ考え）。
 */

import { Copy, Rows3 } from 'lucide-react'
import { ContextMenu } from '../menu/ContextMenu'

/** メニューを開いた行の中身。開いた時点で組み立てる。 */
export interface SessionMenuState {
  x: number
  y: number
  /** `SID,SERIAL#`。見出しにも出す。 */
  identity: string
  /** 「行をコピー」で写す 1 行。 */
  row: string
}

interface SessionContextMenuProps {
  state: SessionMenuState
  /** 文字列をクリップボードへ書く。 */
  onCopy: (text: string) => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function SessionContextMenu({ state, onCopy, onClose }: SessionContextMenuProps) {
  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      heading={`SID ${state.identity}`}
      width={210}
      testId="session-context-menu"
      entries={[
        {
          kind: 'item',
          label: 'SID,SERIAL# をコピー',
          icon: <Copy size={13} />,
          onSelect: () => onCopy(state.identity),
        },
        {
          kind: 'item',
          label: '行をコピー',
          icon: <Rows3 size={13} />,
          onSelect: () => onCopy(state.row),
        },
      ]}
      onClose={onClose}
    />
  )
}
