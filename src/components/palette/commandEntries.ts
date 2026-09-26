/**
 * コマンドの表（ADR 0035）の行を、パレットの項目へ組み立てる。
 *
 * 表そのものと実行の裁定は仲介者（`src/mediator/commands.ts`）が持つ。ここは
 * 見せ方（キーの表記・並べるかどうか）だけを受け持ち、仲介者の値は import しない。
 * 表の行と実行の口は呼び出し側から受け取る。
 */

import type { Chord, Command } from '../../mediator/commands'
import type { PaletteCommand } from './CommandPalette'

/**
 * 組み合わせを macOS の表記にする。修飾は `⌃⌥⇧⌘` の順に並べる。
 *
 * メニューバーと同じ並びにしておかないと、利用者が見慣れた表記と食い違う。
 *
 * @param chord 組み合わせ
 */
export function formatChord(chord: Chord): string {
  return [
    chord.ctrl ? '⌃' : '',
    chord.alt ? '⌥' : '',
    chord.shift ? '⇧' : '',
    '⌘',
    chord.key.toUpperCase(),
  ].join('')
}

/**
 * パレットに出すキーの表記。キーが無ければ空文字。
 *
 * 表が振り分けるキーは組み合わせから作り、CodeMirror が持つキーは表に書いた
 * 表記をそのまま使う。表記を手で書き写すと、組み合わせを変えたときに食い違う。
 *
 * @param command コマンド
 */
export function shortcutLabel(command: Command): string {
  if (command.key === null) {
    return ''
  }
  return command.key.owner === 'window' ? formatChord(command.key.chord) : command.key.label
}

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
 * @param commands 並べる表
 * @param execute 選ばれたコマンドを実行する口
 */
export function paletteCommands(
  commands: readonly Command[],
  execute: (command: Command) => void,
): PaletteCommand[] {
  return commands
    .filter((command) => command.inPalette && (command.available?.() ?? true))
    .map((command) => ({
      id: command.id,
      label: command.label,
      shortcut: shortcutLabel(command),
      run: () => execute(command),
    }))
}
