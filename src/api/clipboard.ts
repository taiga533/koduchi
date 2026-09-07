/**
 * クリップボードの窓口（ADR 0010）。
 *
 * `src/api/db.ts` と同じ考え方で、Tauri のプラグイン呼び出しをこの層に閉じ込める。
 * テストからは実装ごと差し替えるため、mock ライブラリを使わずに書き込んだ文字列を
 * 確かめられる。
 *
 * Rust 側では `tauri_plugin_clipboard_manager` を登録し、
 * `capabilities/default.json` に `clipboard-manager:allow-write-text` を足してある。
 * 権限が無いと実行時に権限エラーになる。
 */

import { writeText } from '@tauri-apps/plugin-clipboard-manager'

/** クリップボード操作の窓口。貼り付けは対象外のため書き込みだけを持つ。 */
export interface ClipboardApi {
  /** 文字列をクリップボードへ書く。 */
  writeText(text: string): Promise<void>
}

/** Tauri のプラグインを呼ぶ実装。 */
const tauriClipboardApi: ClipboardApi = {
  writeText: (text) => writeText(text),
}

let current: ClipboardApi = tauriClipboardApi

/** 現在使われている窓口を返す。 */
export function getClipboardApi(): ClipboardApi {
  return current
}

/**
 * 窓口を差し替える。テストからのみ使う。
 *
 * @param api 差し替える実装
 */
export function setClipboardApi(api: ClipboardApi): void {
  current = api
}

/** 窓口を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetClipboardApi(): void {
  current = tauriClipboardApi
}
