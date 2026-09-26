/**
 * コマンドの表（ADR 0035）の行を、パレットの項目へ組み立てる。
 *
 * 表そのものと実行の裁定は仲介者（`src/mediator/commands.ts`）が持つ。ここは
 * 見せ方（並べるかどうか）だけを受け持ち、仲介者の値は import しない。
 * 表の行・今の割り当て・実行の口は呼び出し側から受け取る。キーの表記は
 * `keybindings/bindings.ts` の `shortcutLabelFor` が持つ（ADR 0037）。
 */

import type { Command } from '../../mediator/commands'
import type { ResolvedKeybindings } from '../../keybindings/bindings'
import { shortcutLabelFor } from '../../keybindings/bindings'
import type { PaletteCommand } from './CommandPalette'

/**
 * コマンドパレットに並べる項目を表から作る（ADR 0018）。
 *
 * 中身は既存のキーバインドで呼べるものだけである。パレットのためだけの動作は
 * 作らない。キーを覚えていなくても辿り着けるようにするのが役目だからである。
 * 今使えないコマンド（`available` が偽）は並べない。
 *
 * 項目を選んだときの実行は `execute` に任せる。画面にしか無いもの（エディタの
 * カーソルなど）を読むのは、選ばれた時点まで遅らせる。
 *
 * キーの表記は既定ではなく、利用者が割り当て直した後のもの（ADR 0037）を出す。
 *
 * @param commands 並べる表
 * @param keybindings 今の割り当て
 * @param execute 選ばれたコマンドを実行する口
 */
export function paletteCommands(
  commands: readonly Command[],
  keybindings: ResolvedKeybindings,
  execute: (command: Command) => void,
): PaletteCommand[] {
  return commands
    .filter((command) => command.inPalette && (command.available?.() ?? true))
    .map((command) => ({
      id: command.id,
      label: command.label,
      shortcut: shortcutLabelFor(command.id, keybindings),
      run: () => execute(command),
    }))
}
