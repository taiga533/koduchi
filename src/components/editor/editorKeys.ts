/**
 * エディタの中で振り分けるキー（ADR 0037）。
 *
 * コマンドの表の `editor` の行（実行 3 つ・中止・整形）は、CodeMirror の keymap が
 * 振り分ける。キーは表の既定ではなく、利用者が割り当て直した後のものを使う。
 * 部品は仲介者の値を import しないため、ここには表の `id` だけを持ち、
 * 表と食い違っていないことは `mediator/commands.test.ts` が見張る。
 */

import type { Chord, KeyPress } from '../../keybindings/chord'
import { matchesChord } from '../../keybindings/chord'

/** エディタが振り分ける操作。値はコマンドの表の `id` と同じである。 */
export const EDITOR_ACTIONS = ['run', 'run-selection', 'run-script', 'cancel', 'format'] as const

/** エディタが振り分ける操作。 */
export type EditorAction = (typeof EDITOR_ACTIONS)[number]

/**
 * 打鍵に当たるエディタの操作を探す。無ければ `null`。
 *
 * 整形の `⇧⌥F` のように `⌥` で文字が化ける打鍵も、`matchesChord` が物理のキーで
 * 読み戻す（ADR 0024 の手当てを一般にしたもの）。keymap にキーの名前で
 * 登録すると、利用者の割り当て直しにも `⌥` の化けにも追随できない。
 *
 * @param press 打鍵
 * @param chords 操作の `id` から今のキー
 */
export function findEditorAction(
  press: KeyPress,
  chords: ReadonlyMap<string, Chord>,
): EditorAction | null {
  for (const action of EDITOR_ACTIONS) {
    const chord = chords.get(action)
    if (chord && matchesChord(press, chord)) {
      return action
    }
  }
  return null
}
