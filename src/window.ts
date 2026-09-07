/**
 * ウィンドウの識別（ADR 0009）。
 *
 * 1 接続 = 1 ウィンドウであり、セッションの復元はウィンドウごとに行う
 * （ADR 0005）。その鍵になるのが Tauri のウィンドウラベルである。
 */

import { getCurrentWindow } from '@tauri-apps/api/window'

/** ブラウザやテストなど、Tauri の外で動かしたときに使うラベル。 */
const FALLBACK_LABEL = 'main'

/**
 * 今いるウィンドウのラベルを返す。
 *
 * Tauri の外（`bun run dev` のブラウザ表示や jsdom のテスト）では取得できない
 * ため、既定のラベルを返す。セッションの保存先が 1 つに定まればよい。
 */
export function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return FALLBACK_LABEL
  }
}

/**
 * ウィンドウを閉じようとしたときに割り込む（ADR 0012）。
 *
 * `handler` が偽を返すと、そのウィンドウは閉じない。未コミットの変更を黙って
 * 捨てさせないための関所である。アプリの終了も Rust 側から各ウィンドウを
 * 閉じにいくため、この経路を通る。
 *
 * Tauri の外（`bun run dev` のブラウザ表示や jsdom のテスト）では割り込めない
 * ため、何もしない後片付けを返す。
 *
 * @param handler 閉じてよいかを返す処理
 *
 * @returns 割り込みをやめるための後片付け
 */
export function onWindowCloseRequested(handler: () => Promise<boolean>): () => void {
  let unlisten: (() => void) | null = null
  let 取り消された = false

  try {
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!(await handler())) {
          event.preventDefault()
        }
      })
      .then((stop) => {
        if (取り消された) {
          stop()
          return
        }
        unlisten = stop
      })
      .catch(() => {})
  } catch {
    // Tauri の外では割り込めない。
  }

  return () => {
    取り消された = true
    unlisten?.()
  }
}
