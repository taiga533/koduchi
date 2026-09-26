/**
 * ネイティブのダイアログの窓口（ADR 0010・0035）。
 *
 * `src/api/clipboard.ts` と同じ考え方で、`@tauri-apps/plugin-dialog` の呼び出しを
 * この層に閉じ込める。仲介者（`src/mediator/`）はファイルの保存先を選ばせたり、
 * 実測付きの実行計画の前に確かめたりするが、ネイティブのダイアログは jsdom では
 * 開けない。窓口ごと差し替えられるようにしておけば、仲介者の単体テストを
 * mock ライブラリなしで書ける。
 *
 * 未コミットの確認（`transaction/pendingChanges.ts`）とタブを閉じる確認
 * （`components/editor/closing.ts`）は、文言と組み立てを抱えた専用の差し替え口を
 * 既に持っているため、ここへは寄せない。
 */

import {
  confirm as tauriConfirm,
  open as tauriOpen,
  save as tauriSave,
} from '@tauri-apps/plugin-dialog'

/** 確認の見た目。`@tauri-apps/plugin-dialog` の `confirm` の選択肢のうち使うものだけ。 */
export interface ConfirmOptions {
  title: string
  kind: 'info' | 'warning' | 'error'
}

/** ファイルの絞り込み。 */
export interface FileFilter {
  name: string
  extensions: string[]
}

/** ネイティブのダイアログの窓口。 */
export interface DialogApi {
  /** はい / いいえを尋ねる。真なら「はい」。 */
  confirm(message: string, options: ConfirmOptions): Promise<boolean>
  /** 保存先を選ばせる。取り消されたら `null`。 */
  save(options: { defaultPath: string; filters: FileFilter[] }): Promise<string | null>
  /** 開くファイルを 1 つ選ばせる。取り消されたら `null`。 */
  open(options: { filters: FileFilter[] }): Promise<string | null>
}

/** Tauri のプラグインを呼ぶ実装。 */
const tauriDialogApi: DialogApi = {
  confirm: (message, options) => tauriConfirm(message, options),
  save: (options) => tauriSave(options),
  // 複数選択は許さない。戻り値が文字列の配列になる道をここで断っておく。
  open: async (options) => {
    const path = await tauriOpen({ multiple: false, filters: options.filters })
    return typeof path === 'string' ? path : null
  },
}

let current: DialogApi = tauriDialogApi

/** 現在使われている窓口を返す。 */
export function getDialogApi(): DialogApi {
  return current
}

/**
 * 窓口を差し替える。テストからのみ使う。
 *
 * @param api 差し替える実装
 */
export function setDialogApi(api: DialogApi): void {
  current = api
}

/** 窓口を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetDialogApi(): void {
  current = tauriDialogApi
}
