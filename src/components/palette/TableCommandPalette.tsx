import { useMemo } from 'react'
import type { Command } from '../../mediator/commands'
import type { ResolvedKeybindings } from '../../keybindings/bindings'
import { CommandPalette } from './CommandPalette'
import { paletteCommands } from './commandEntries'

interface TableCommandPaletteProps {
  /** コマンドの表（ADR 0035）。 */
  commands: readonly Command[]
  /** 今の割り当て（ADR 0037）。キーの表記に使う。 */
  keybindings: ResolvedKeybindings
  /** 選ばれたコマンドを実行する。裁定は呼び出し側（仲介者）が持つ。 */
  onRunCommand: (command: Command) => void
  /** 接続の表示名。履歴を現ウィンドウの接続に絞るのに使う。 */
  connectionName: string
  /** 保存済みクエリと履歴の SQL をエディタへ入れる。 */
  onUseSql: (sql: string) => void
  /** スキーマのオブジェクトをサイドバーのツリーで示す。 */
  onRevealSchemaObject: (schemaName: string, objectName: string | null) => void
  /** esc または決定の後に閉じる。 */
  onClose: () => void
}

/**
 * コマンドの表からパレットの一覧を作り、`CommandPalette` へ渡す包み（ADR 0035）。
 *
 * 一覧はパレットを開いている間だけ要る。開いた時点で表から作れば、`available` の
 * 判定もその時点のものになる。アプリのルートで作ると、開いていない間も描き直す
 * たびに作り直すことになる。実行は `onRunCommand` で報告するだけにし、仲介者の
 * 値を import しない（部品は報告し、裁定は仲介者が持つ）。
 */
export function TableCommandPalette({
  commands,
  keybindings,
  onRunCommand,
  ...props
}: TableCommandPaletteProps) {
  const items = useMemo(
    () => paletteCommands(commands, keybindings, onRunCommand),
    [commands, keybindings, onRunCommand],
  )
  return <CommandPalette commands={items} {...props} />
}
