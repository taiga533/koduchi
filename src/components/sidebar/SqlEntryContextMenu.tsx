/**
 * 履歴と保存済みクエリの行の右クリックメニュー（ADR 0038）。
 *
 * 2 つの一覧は作りを揃えてある（`SavedQueryList.tsx` の冒頭）ため、メニューも
 * 1 つにした。違いは保存済みクエリだけが「名前を変更」を持つことだけである。
 *
 * 一覧は SQL の 1 行目しか出さないため、全文を写す道はここの「SQL をコピー」
 * だけである。「新しいタブで開く」は今のタブを上書きせずに開く道で、ツリーの
 * 「`SELECT` を開く」と同じく**実行はしない**（ADR 0020）。
 *
 * 削除は `✕`、名前の変更は鉛筆と同じ動きであり、新しい裁定は無い。
 */

import { Copy, FilePlus2, Pencil, TextCursorInput, Trash2 } from 'lucide-react'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu, SEPARATOR } from '../menu/ContextMenu'

interface SqlEntryContextMenuProps {
  x: number
  y: number
  /** 見出し。保存済みクエリは名前、履歴は SQL の 1 行目。 */
  heading: string
  onUse: () => void
  onOpenInNewTab: () => void
  onCopy: () => void
  /** 名前を変える。省けば項目を出さない（履歴には名前が無い）。 */
  onRename?: () => void
  onRemove: () => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function SqlEntryContextMenu({
  x,
  y,
  heading,
  onUse,
  onOpenInNewTab,
  onCopy,
  onRename,
  onRemove,
  onClose,
}: SqlEntryContextMenuProps) {
  const entries: ContextMenuEntry[] = [
    {
      kind: 'item',
      label: 'エディタへ入れる',
      icon: <TextCursorInput size={13} />,
      onSelect: onUse,
    },
    {
      kind: 'item',
      label: '新しいタブで開く',
      icon: <FilePlus2 size={13} />,
      onSelect: onOpenInNewTab,
    },
    { kind: 'item', label: 'SQL をコピー', icon: <Copy size={13} />, onSelect: onCopy },
    SEPARATOR,
  ]
  if (onRename) {
    entries.push({
      kind: 'item',
      label: '名前を変更',
      icon: <Pencil size={13} />,
      onSelect: onRename,
    })
  }
  entries.push({ kind: 'item', label: '削除', icon: <Trash2 size={13} />, onSelect: onRemove })

  return (
    <ContextMenu
      x={x}
      y={y}
      heading={heading}
      entries={entries}
      testId="sql-entry-context-menu"
      onClose={onClose}
    />
  )
}
