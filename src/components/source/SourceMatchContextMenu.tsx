/**
 * ソース検索の当たりの右クリックメニュー（ADR 0038）。
 *
 * 項目は「オブジェクト名をコピー」と、当たった行の上で開いたときだけの
 * 「当たった行をコピー」。見つけた処理の名前をエディタやチケットへ写す道が
 * 無かったためである。名前は画面の見出しと同じ `所有者.名前` で写し、行は
 * `ALL_SOURCE.TEXT` を手を加えずに写す（行頭の字下げも残す）。
 *
 * **定義タブを開く・エディタへ挿入する動線は作らない。**当たりからの移動先は
 * ADR 0021 で決めておらず、種別も `SourceKind`（本体を含む）で定義タブの
 * `ObjectKind` へそのまま繋がらない（ADR 0038 の「足さない場所」）。
 */

import { Copy, TextQuote } from 'lucide-react'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu } from '../menu/ContextMenu'

/** メニューを開いた場所の中身。 */
export interface SourceMatchMenuState {
  x: number
  y: number
  /** `所有者.名前`。 */
  objectName: string
  /** 当たった行の本文。見出しの上で開いたときは `null`。 */
  lineText: string | null
}

interface SourceMatchContextMenuProps {
  state: SourceMatchMenuState
  /** 文字列をクリップボードへ書く。 */
  onCopy: (text: string) => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function SourceMatchContextMenu({ state, onCopy, onClose }: SourceMatchContextMenuProps) {
  const entries: ContextMenuEntry[] = [
    {
      kind: 'item',
      label: 'オブジェクト名をコピー',
      icon: <Copy size={13} />,
      onSelect: () => onCopy(state.objectName),
    },
  ]
  const lineText = state.lineText
  if (lineText !== null) {
    entries.push({
      kind: 'item',
      label: '当たった行をコピー',
      icon: <TextQuote size={13} />,
      onSelect: () => onCopy(lineText),
    })
  }

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      heading={state.objectName}
      width={210}
      entries={entries}
      testId="source-match-context-menu"
      onClose={onClose}
    />
  )
}
