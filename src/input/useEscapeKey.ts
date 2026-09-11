/**
 * オーバーレイを `esc` で閉じるための唯一の入口（ADR 0031）。
 *
 * **オーバーレイの器に `onKeyDown` を付けてはならない。**器に付けると、その中の
 * どれかに焦点がある間しか打鍵が届かない。暗幕を押すと焦点は `<body>` へ戻る
 * ため（押された `div` は焦点を持てない）、その瞬間からオーバーレイは `esc` で
 * 閉じられなくなる。issue #36 はこれである。
 *
 * そこで打鍵は `window` で受け、受け手は `escapeStack.ts` の積みで 1 つに絞る。
 * `window` の listener は受け手が 1 つ以上あるあいだだけ張る。
 *
 * 見る順は 3 つで、どれも飛ばさない。
 *
 * 1. `event.defaultPrevented` … より近い所（入力欄や CodeMirror）が既に処理した
 *    `esc` は二重に扱わない。`App.tsx` の `keydown` と同じ作法である。
 * 2. `isComposingKey` … 変換中の `esc` は変換の取り消しであって「閉じる」では
 *    ない（ADR 0025）。`window` で受ける以上、この関所はここにも要る。
 * 3. 積みの末尾 … いちばん後に開いたオーバーレイだけが閉じる。
 */

import { useEffect, useRef } from 'react'
import { isComposingKey } from './ime'
import { dispatchEscape, pushEscapeHandler } from './escapeStack'

/** `window` に張った listener。受け手が居るあいだだけ張る。 */
let 張った件数 = 0

/**
 * `window` が受け取った `esc` を、いちばん手前のオーバーレイへ渡す。
 *
 * @param event 起きた打鍵
 */
function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || isComposingKey(event)) {
    return
  }
  if (dispatchEscape()) {
    event.preventDefault()
  }
}

/**
 * `esc` でこのオーバーレイを閉じる。
 *
 * 渡された関数は毎回の描画で別物になりうるが、**積みに入る受け手の同一性は
 * 保つ。**描画のたびに積み直すと、後ろに居たはずのオーバーレイが手前へ繰り
 * 上がってしまうためである。
 *
 * @param onEscape `esc` が押されたときに走らせる処理。ふつうは `onClose`
 */
export function useEscapeKey(onEscape: () => void): void {
  const 最新 = useRef(onEscape)

  useEffect(() => {
    最新.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (張った件数 === 0) {
      window.addEventListener('keydown', onWindowKeyDown)
    }
    張った件数 += 1

    const 外す = pushEscapeHandler(() => 最新.current())

    return () => {
      外す()
      張った件数 -= 1
      if (張った件数 === 0) {
        window.removeEventListener('keydown', onWindowKeyDown)
      }
    }
  }, [])
}
