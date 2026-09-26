/**
 * 定義タブの列・制約・索引の行の右クリックメニュー（ADR 0038）。
 *
 * 項目は「名前をコピー」「この行をコピー」の 2 つ。列名 1 つが欲しいときに、
 * 内訳を丸ごと写して削るしかなかったためである。内訳まるごとのコピーは
 * タブの並びの右端のボタンのまま（ADR 0019）。
 *
 * **「エディタへ挿入」は置かない。**定義タブを選んでいる間はエディタそのものが
 * 描かれない（ADR 0022）。
 */

import { Copy, Rows3 } from 'lucide-react'
import { ContextMenu } from '../menu/ContextMenu'

/** メニューを開いた行の中身。開いた時点で組み立てる。 */
export interface DefinitionRowMenuState {
  x: number
  y: number
  /** 名前。見出しにも出す。 */
  name: string
  /** 「この行をコピー」で写す 1 行。 */
  row: string
}

interface DefinitionRowContextMenuProps {
  state: DefinitionRowMenuState
  /** 文字列をクリップボードへ書く。 */
  onCopy: (text: string) => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function DefinitionRowContextMenu({
  state,
  onCopy,
  onClose,
}: DefinitionRowContextMenuProps) {
  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      heading={state.name}
      testId="definition-row-context-menu"
      entries={[
        {
          kind: 'item',
          label: '名前をコピー',
          icon: <Copy size={13} />,
          onSelect: () => onCopy(state.name),
        },
        {
          kind: 'item',
          label: 'この行をコピー',
          icon: <Rows3 size={13} />,
          onSelect: () => onCopy(state.row),
        },
      ]}
      onClose={onClose}
    />
  )
}
