/**
 * タブ帯のタブの右クリックメニュー（ADR 0038）。
 *
 * ADR 0032 が「メニューを作るかどうかは別に決める」として持ち越した一式である。
 * **どの項目も右クリックしたタブに効き、選択は動かさない。**保存のためにタブを
 * 選び直すと、見ていた結果ペインが入れ替わってしまう。
 *
 * 項目はどれも既存の操作の別の入口である。閉じるのは `closeTabAndRelease` の
 * 関所、名前の変更は `F2` と同じ編集の開始、保存は `⌘S` / `⇧⌘S` と同じ裁定を
 * 通る。キーの表記は割り当て直しに追随させるため `useShortcutLabel` で引く
 * （ADR 0037）。
 *
 * 使えない項目は押せなくするのではなく出さない。スキーマツリーのメニュー
 * （ADR 0020）と同じ作りである。
 */

import { Copy, Save, SaveAll, TextCursorInput, X, XSquare } from 'lucide-react'
import { formatChord } from '../../keybindings/chord'
import { useShortcutLabel } from '../../keybindings/context'
import type { EditorTab } from '../../stores/tab'
import { isSqlTab } from '../../stores/tabKinds'
import type { ContextMenuEntry } from '../menu/ContextMenu'
import { ContextMenu, SEPARATOR } from '../menu/ContextMenu'
import { canRenameTab } from './tabNaming'

/** 名前の付け直しのキー。タブ帯の中の固定のキーで、割り当て直せない（ADR 0032・0037）。 */
const RENAME_KEY = formatChord({ key: 'f2' })

interface TabContextMenuProps {
  x: number
  y: number
  /** 右クリックしたタブ。 */
  tab: EditorTab
  /** 見出しに出す名前。タブ帯に出ている名前と同じである。 */
  heading: string
  /** 他のタブがあるか。 */
  hasOthers: boolean
  /** 右側にタブがあるか。 */
  hasRight: boolean
  onClose: () => void
  onCloseOthers: () => void
  onCloseRight: () => void
  onRename: () => void
  onSave: () => void
  onSaveAs: () => void
  /** 保存先のパスをクリップボードへ書く。 */
  onCopyPath: () => void
  /** メニューを閉じる。 */
  onDismiss: () => void
}

export function TabContextMenu({
  x,
  y,
  tab,
  heading,
  hasOthers,
  hasRight,
  onClose,
  onCloseOthers,
  onCloseRight,
  onRename,
  onSave,
  onSaveAs,
  onCopyPath,
  onDismiss,
}: TabContextMenuProps) {
  const closeKey = useShortcutLabel('close-tab')
  const saveKey = useShortcutLabel('save-file')
  const saveAsKey = useShortcutLabel('save-file-as')

  const entries: ContextMenuEntry[] = [
    { kind: 'item', label: '閉じる', icon: <X size={13} />, onSelect: onClose, shortcut: closeKey },
  ]
  if (hasOthers) {
    entries.push({
      kind: 'item',
      label: '他のタブを閉じる',
      icon: <XSquare size={13} />,
      onSelect: onCloseOthers,
    })
  }
  if (hasRight) {
    entries.push({
      kind: 'item',
      label: '右側のタブを閉じる',
      icon: <XSquare size={13} />,
      onSelect: onCloseRight,
    })
  }
  if (canRenameTab(tab)) {
    entries.push(SEPARATOR, {
      kind: 'item',
      label: '名前を変更',
      icon: <TextCursorInput size={13} />,
      onSelect: onRename,
      shortcut: RENAME_KEY,
    })
  }
  if (isSqlTab(tab)) {
    entries.push(
      SEPARATOR,
      {
        kind: 'item',
        label: '保存',
        icon: <Save size={13} />,
        onSelect: onSave,
        shortcut: saveKey,
      },
      {
        kind: 'item',
        label: '名前を付けて保存',
        icon: <SaveAll size={13} />,
        onSelect: onSaveAs,
        shortcut: saveAsKey,
      },
    )
    if (tab.filePath !== null) {
      entries.push({
        kind: 'item',
        label: 'ファイルのパスをコピー',
        icon: <Copy size={13} />,
        onSelect: onCopyPath,
      })
    }
  }

  return (
    <ContextMenu
      x={x}
      y={y}
      heading={heading}
      width={220}
      entries={entries}
      testId="tab-context-menu"
      onClose={onDismiss}
    />
  )
}
