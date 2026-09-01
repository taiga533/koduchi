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
