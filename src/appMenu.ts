/**
 * メニューバーからの知らせ（ADR 0036）。
 *
 * ネイティブのメニューは Rust 側が組み、押された項目を焦点のあるウィンドウへ
 * イベントで送る（`src-tauri/src/menu.rs`）。ここはそのイベントを受ける口である。
 */

import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

/** 設定画面を開かせるイベントの名前。`src-tauri/src/menu.rs` の `OPEN_SETTINGS_EVENT` と組である。 */
export const OPEN_SETTINGS_EVENT = 'koduchi://open-settings'

/**
 * メニューの「設定…」（`⌘,`）が押されたときに呼ぶ処理を登録する。
 *
 * 聞くのはこのウィンドウに宛てたイベントだけである。Rust 側は焦点のある
 * ウィンドウ 1 つにだけ送るため、全体へ聞くと他のウィンドウでも開いてしまう。
 *
 * Tauri の外（`bun run dev` のブラウザ表示や jsdom のテスト）では聞く相手が
 * 居ないため、何もしない後片付けを返す。これは失敗ではない。Tauri の中で聞くのに
 * 失敗したときは握らず、未処理の拒否として大域へ上げる。黙って握ると「`⌘,` を
 * 押しても何も起きない」だけが残り、原因を追えなくなる。
 *
 * @param handler 設定画面を開く処理
 *
 * @returns 聞くのをやめるための後片付け
 */
export function onOpenSettingsRequested(handler: () => void): () => void {
  if (!isTauri()) {
    return () => {}
  }

  let unlisten: (() => void) | null = null
  let cancelled = false

  void getCurrentWebviewWindow()
    .listen(OPEN_SETTINGS_EVENT, () => {
      // 外す往復の間に届いたイベントで、描き終えた画面へ手を出さない。
      if (!cancelled) {
        handler()
      }
    })
    .then((stop) => {
      // 登録が済む前に後片付けされたら、済んだ時点で外す。
      if (cancelled) {
        stop()
        return
      }
      unlisten = stop
    })

  return () => {
    cancelled = true
    unlisten?.()
  }
}
