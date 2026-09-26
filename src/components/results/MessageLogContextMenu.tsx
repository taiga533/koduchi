/**
 * メッセージタブのログ 1 件の右クリックメニュー（ADR 0038）。
 *
 * 項目は「SQL をコピー」「新しいタブで開く」「エラーをコピー」。前の 2 つは
 * 実行した SQL のログだけに出す（報せの見出しは SQL ではない）。3 つめは
 * エラーがあるときだけ出し、`ErrorCopyButton` と同じく文言に手を加えずに写す
 * （issue #56）。
 *
 * 「新しいタブで開く」は実行しない。ツリーの「`SELECT` を開く」（ADR 0020）と
 * 同じく、流すかどうかは利用者が決める。
 */

import { Copy, FilePlus2, TriangleAlert } from 'lucide-react'
import type { LogEntry } from '../../stores/execution'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu } from '../menu/ContextMenu'

interface MessageLogContextMenuProps {
  x: number
  y: number
  entry: LogEntry
  onCopySql: () => void
  onOpenInNewTab: () => void
  onCopyError: () => void
  /** メニューを閉じる。 */
  onClose: () => void
}

export function MessageLogContextMenu({
  x,
  y,
  entry,
  onCopySql,
  onOpenInNewTab,
  onCopyError,
  onClose,
}: MessageLogContextMenuProps) {
  const entries: ContextMenuEntry[] = []
  if (entry.kind === 'statement') {
    entries.push(
      { kind: 'item', label: 'SQL をコピー', icon: <Copy size={13} />, onSelect: onCopySql },
      {
        kind: 'item',
        label: '新しいタブで開く',
        icon: <FilePlus2 size={13} />,
        onSelect: onOpenInNewTab,
      },
    )
  }
  if (entry.error !== null) {
    entries.push({
      kind: 'item',
      label: 'エラーをコピー',
      icon: <TriangleAlert size={13} />,
      onSelect: onCopyError,
    })
  }

  return (
    <ContextMenu
      x={x}
      y={y}
      entries={entries}
      testId="message-log-context-menu"
      onClose={onClose}
    />
  )
}
