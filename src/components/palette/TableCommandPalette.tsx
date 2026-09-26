/**
 * コマンドの表（ADR 0035）からパレットの一覧を作り、`CommandPalette` へ渡す包み。
 *
 * 一覧はパレットを開いている間だけ要る。開いた時点で表から作れば、`available` の
 * 判定もその時点のものになる。アプリのルートで作ると、パレットを開いていない
 * 間も描き直すたびに作り直すことになる。
 */

import { useMemo } from 'react'
import type { CommandScreen } from '../../mediator/commands'
import { paletteCommands, runCommand } from '../../mediator/commands'
import { CommandPalette } from './CommandPalette'

interface TableCommandPaletteProps {
  /** コマンドの実行に要る、画面にしか無いもの。 */
  screen: CommandScreen
  /** 接続の表示名。履歴を現ウィンドウの接続に絞るのに使う。 */
  connectionName: string
  /** 保存済みクエリと履歴の SQL をエディタへ入れる。 */
  onUseSql: (sql: string) => void
  /** スキーマのオブジェクトをサイドバーのツリーで示す。 */
  onRevealSchemaObject: (schemaName: string, objectName: string | null) => void
  /** esc または決定の後に閉じる。 */
  onClose: () => void
}

export function TableCommandPalette({ screen, ...props }: TableCommandPaletteProps) {
  const commands = useMemo(
    () => paletteCommands((command) => runCommand(command, screen)),
    [screen],
  )
  return <CommandPalette commands={commands} {...props} />
}
