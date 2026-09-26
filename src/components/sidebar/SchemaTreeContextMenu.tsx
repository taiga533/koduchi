/**
 * スキーマツリーの右クリックメニュー（ADR 0020・0022）。
 *
 * 器は共通の `ContextMenu`（ADR 0038）。項目は「名前をコピー」「エディタへ
 * 挿入」「`SELECT` を開く」「定義を開く」の 4 つ。3 つめは列を持つ種別
 * （表・ビュー・マテビュー）のとき、4 つめはオブジェクトの行で繋がっている
 * ときだけ出す。
 *
 * **「定義を開く」は末尾に置く。**先に入っていた 3 項目の位置を動かさないため
 * であり、タブが増える重いほうを下へ寄せる並びとも合う（ADR 0022）。
 *
 * 見出しに対象の名前を出す。ツリーは 1 行が細く、右クリックした行を取り違えた
 * まま操作してしまうことがあるためである。
 *
 * 焦点は奪わない（ADR 0038 で結果テーブルのメニューに揃えた）。閉じた後も
 * 焦点がツリーの行に残り、`↑` / `↓` がそのまま効く。
 */

import { Copy, Table2, TableProperties, TextCursorInput } from 'lucide-react'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu } from '../menu/ContextMenu'

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
  const entries: ContextMenuEntry[] = [
    { kind: 'item', label: '名前をコピー', icon: <Copy size={13} />, onSelect: onCopy },
    {
      kind: 'item',
      label: 'エディタへ挿入',
      icon: <TextCursorInput size={13} />,
      onSelect: onInsert,
    },
  ]
  if (canSelect) {
    entries.push({
      kind: 'item',
      label: 'SELECT を開く',
      icon: <Table2 size={13} />,
      onSelect: onOpenSelect,
    })
  }
  if (canOpenDefinition) {
    entries.push({
      kind: 'item',
      label: '定義を開く',
      icon: <TableProperties size={13} />,
      onSelect: onOpenDefinition,
    })
  }

  return (
    <ContextMenu
      x={x}
      y={y}
      heading={target}
      entries={entries}
      testId="schema-tree-context-menu"
      onClose={onClose}
    />
  )
}
