/**
 * 今のキーの割り当てを部品へ配る口（ADR 0037）。
 *
 * 割り当ての解決にはコマンドの表（仲介者の値）が要るが、部品は仲介者の値を
 * import しない。解決は `App.tsx` が 1 度だけ行い、ここを通して配る。ボタンや
 * メニューに添えるキーの表記を手で書くと、割り当て直したときに食い違う。
 */

import { createContext, useContext } from 'react'
import type { ResolvedKeybindings } from './bindings'
import { shortcutLabelFor } from './bindings'

/** 配る前の値。キーを 1 つも持たない。 */
const NO_KEYBINDINGS: ResolvedKeybindings = { chords: new Map(), issues: [] }

/** 今の割り当て。`App.tsx` が値を入れる。 */
export const KeybindingsContext = createContext<ResolvedKeybindings>(NO_KEYBINDINGS)

/** 今の割り当てを読む。 */
export function useKeybindings(): ResolvedKeybindings {
  return useContext(KeybindingsContext)
}

/**
 * 操作の `id` から今のキーの表記を読む。キーが無ければ空文字。
 *
 * @param id 操作の `id`
 */
export function useShortcutLabel(id: string): string {
  return shortcutLabelFor(id, useKeybindings())
}
