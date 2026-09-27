/**
 * メニューバーからの知らせ（ADR 0036・0040）。
 *
 * ネイティブのメニューは Rust 側が組み、押された項目をコマンドの表（ADR 0035）の
 * 識別子にして焦点のあるウィンドウへイベントで送る（`src-tauri/src/menu.rs`）。
 * ここはそのイベントを受ける口である。
 */

import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

/** メニューから操作を走らせるイベントの名前。`src-tauri/src/menu.rs` の `MENU_COMMAND_EVENT` と組である。 */
export const MENU_COMMAND_EVENT = 'koduchi://menu-command'

/**
 * メニューの項目が押されたときに呼ぶ処理を登録する。
 *
 * 渡すのはコマンドの表の識別子だけである。受け手が表の行を引いてキーやパレットと
 * 同じ裁定を走らせるためで、メニューのための裁定をここに持たない。
 *
 * 聞くのはこのウィンドウに宛てたイベントだけである。Rust 側は焦点のある
 * ウィンドウ 1 つにだけ送るため、全体へ聞くと他のウィンドウでも走ってしまう。
 *
 * Tauri の外（`bun run dev` のブラウザ表示や jsdom のテスト）では聞く相手が
 * 居ないため、何もしない後片付けを返す。これは失敗ではない。Tauri の中で聞くのに
 * 失敗したときは握らず、未処理の拒否として大域へ上げる。黙って握ると「メニューを
 * 押しても何も起きない」だけが残り、原因を追えなくなる。
 *
 * @param handler コマンドの識別子を受けて走らせる処理
 *
 * @returns 聞くのをやめるための後片付け
 */
export function onMenuCommand(handler: (commandId: string) => void): () => void {
  if (!isTauri()) {
    return () => {}
  }

  let unlisten: (() => void) | null = null
  let cancelled = false

  void getCurrentWebviewWindow()
    .listen<string>(MENU_COMMAND_EVENT, (event) => {
      // 外す往復の間に届いたイベントで、描き終えた画面へ手を出さない。
      if (!cancelled) {
        handler(event.payload)
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
