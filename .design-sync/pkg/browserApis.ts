/**
 * Tauri の外で部品を描くための窓口（design-sync）。
 *
 * Claude Design の描画環境には IPC が無く、`invoke` は例外になる。部品の多くは
 * 描いた直後に履歴や設定を取りにいくため、そのままでは画面の代わりにエラーが出る。
 * DB の窓口は「答えが返らない」代役に差し替える。返らない約束なら、ストアは
 * デザインの側が `setState` で置いた状態のまま動かず、例外もメッセージも出ない。
 */
import { getDbApi, setDbApi } from '../../src/api/db'
import type { DbApi } from '../../src/api/db'
import { setClipboardApi } from '../../src/api/clipboard'

/** Tauri の上で動いているかを返す。アプリ本体では差し替えないための判定。 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * どのメソッドを呼んでも決着しない約束を返す DB の窓口を作る。
 *
 * メソッドの一覧は本物の窓口から写す。1 つずつ書くと、`DbApi` に項目が増えたときに
 * 代役が追随せず、型だけ通って実行時に `undefined is not a function` になる。
 */
function pendingDbApi(): DbApi {
  const names = Object.keys(getDbApi())
  return Object.fromEntries(
    names.map((name) => [name, () => new Promise<never>(() => {})]),
  ) as unknown as DbApi
}

/**
 * 答えたいメソッドだけを書いた DB の窓口を作る。書かなかったメソッドは決着しない。
 *
 * 描いた直後にデータを読みにいく部品（接続の一覧・履歴・パレットなど）へ、
 * 読み込み済みの姿を見せるための入口である。`setDbApi(createDesignDbApi({ ... }))`
 * と使う。メソッドの一覧を呼び出し側で写させないのは、`DbApi` に項目が増えたときに
 * 写しが古びるためである。
 *
 * @param answers 答えを返すメソッド
 *
 * @returns 渡したメソッド以外は決着しない窓口
 */
export function createDesignDbApi(answers: Partial<DbApi>): DbApi {
  return { ...pendingDbApi(), ...answers }
}

/** Tauri の外にいるときだけ、DB とクリップボードの窓口を差し替える。 */
export function installBrowserApis(): void {
  if (isTauri()) return
  setDbApi(pendingDbApi())
  setClipboardApi({
    writeText: (text) => navigator.clipboard?.writeText(text) ?? Promise.resolve(),
  })
}
