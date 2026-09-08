/**
 * 未保存のタブを閉じる前の確認（ADR 0023）。
 *
 * 未保存のバッファは SQLite に保存され再起動で復元される（ADR 0005）が、それが
 * 効くのは**閉じずにアプリを終了したとき**だけである。セッションへ書き出すのは
 * その時点で開いているタブだけ（`selectSession`）なので、タブを閉じた瞬間に
 * その内容はセッションからも消える。書きかけの SQL は本当に失われる。
 *
 * そこで閉じる前に一度だけ尋ねる。ただし**尋ねるのは失うものがあるときだけ**で
 * あり、空のタブと保存済みのタブは今までどおり 1 押しで閉じる。
 *
 * 確認そのものは差し替えられる形にしてある（`setCloseTabDialog`）。ネイティブの
 * ダイアログは jsdom では開けないため、テストはこの境界を差し替えて確かめる
 * （ADR 0010 の「`src/api/` 層の差し替え」・`transaction/pendingChanges.ts` と
 * 同じ考え方）。
 */

import { confirm } from '@tauri-apps/plugin-dialog'

/**
 * 確認の対象になりうるタブ。
 *
 * `dirty` も `content` も省略できる。並びには**それらを持たないタブが混ざる**
 * ためである（定義タブ。ADR 0022 で実際に入った）。持たないタブは失うものが無い。
 *
 * `kind` は読まないが、型として受けておく。すべて省略可の型へ「1 つも項目の
 * 重ならない値」を渡すと TypeScript が弱い型の検査で弾くためであり、タブの
 * 並びの要素をそのまま渡せるようにするための受けである。
 */
export interface ClosableTab {
  dirty?: boolean
  content?: string
  kind?: string
}

/**
 * 閉じる前に確認が要るかを決める。
 *
 * 未保存で、かつ本文が空白だけではないときに限って要る。`⌘T` で開いてすぐ
 * 閉じるタブや、名前を 1 つ挿入して気が変わったタブまで引き止めると、確認が
 * ただの手数になり、いずれ読まずに押されるようになる。
 *
 * @param tab 閉じようとしているタブ
 */
export function needsCloseConfirmation(tab: ClosableTab): boolean {
  return tab.dirty === true && (tab.content ?? '').trim() !== ''
}

/** 未保存のタブを閉じてよいかを尋ねる。真なら閉じる。 */
export type CloseTabDialog = (name: string) => Promise<boolean>

/** Tauri の確認ダイアログを使う実装。 */
const tauriCloseTabDialog: CloseTabDialog = (name) =>
  confirm(`${name} には保存していない変更があります。閉じると失われます。`, {
    title: '保存していない変更',
    kind: 'warning',
    okLabel: '閉じる',
    cancelLabel: '取り消す',
  })

let current: CloseTabDialog = tauriCloseTabDialog

/**
 * タブを閉じてよいかを尋ねる。確認が要らないタブでは尋ねずに真を返す。
 *
 * @param tab 閉じようとしているタブ
 * @param name タブの名前。問いかけに出す
 */
export async function confirmCloseTab(tab: ClosableTab, name: string): Promise<boolean> {
  if (!needsCloseConfirmation(tab)) {
    return true
  }
  return current(name)
}

/**
 * 確認を差し替える。テストからのみ使う。
 *
 * @param dialog 差し替える実装
 */
export function setCloseTabDialog(dialog: CloseTabDialog): void {
  current = dialog
}

/** 確認を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetCloseTabDialog(): void {
  current = tauriCloseTabDialog
}
