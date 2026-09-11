/**
 * タブに出す名前の決め方（ADR 0032）。
 *
 * タブの名前には**出どころの違う 2 つ**がある。
 *
 * - **自動の名前**（`EditorTab.name`）— `無題-1.sql` の連番、開いたファイルの
 *   ファイル名、定義タブならオブジェクト名である。小槌が付ける。
 * - **利用者が付けた名前**（`SqlTab.customName`）— タブ帯で付け直したもの。
 *
 * 2 つを 1 つの欄に混ぜないのは、**付け直しを取り消せるようにする**ためである。
 * 混ぜてしまうと「元の名前」がどこにも残らず、戻す道を別に作ることになる。
 * 分けてあれば、空の名前を確定したときに `customName` を捨てるだけで自動の名前
 * へ戻る。
 *
 * どちらを出すかの判断はここに集める。`TabBar` はもちろん、タブの名前を既定値
 * として使う側（`⇧⌘S` の保存済みクエリ、ADR 0018）も同じ関数を通す。
 */

import { isSqlTab } from '../../stores/tabKinds'
import type { EditorTab } from '../../stores/tab'

/**
 * 打ち込まれた名前を、覚えておく形へ整える。
 *
 * 前後の空白は落とす。**空文字も空白だけも `null` になり、自動の名前へ戻る**
 * （ADR 0032）。取り消しのための別の入口を作らずに済ませるための決まりである。
 *
 * @param draft 入力欄に打ち込まれた文字列
 */
export function normalizeTabName(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * タブ帯に出す名前を返す。
 *
 * 利用者が付けた名前があればそれを、無ければ自動の名前を出す。**ファイルへ
 * 保存し直しても利用者の名前は消えない**（`markSaved` は自動の名前しか書き
 * 換えない）。明示的に付けた名前のほうが強い、という 1 つの決まりで済む。
 *
 * @param tab 対象のタブ
 */
export function tabDisplayName(tab: EditorTab): string {
  return (isSqlTab(tab) ? tab.customName : null) ?? tab.name
}

/**
 * タブの器に付ける `title` を返す。
 *
 * タブは縮むと名前が `…` で省かれるため、全体はここで読める（ADR 0023）。
 * 利用者の名前が自動の名前を覆い隠しているときは、**隠れたほうも添える**。
 * 付け直したタブがどのファイルの、どの無題だったのかを辿れなくなるのを防ぐ。
 *
 * @param tab 対象のタブ
 */
export function tabTitle(tab: EditorTab): string {
  const display = tabDisplayName(tab)
  return display === tab.name ? display : `${display}（${tab.name}）`
}

/**
 * 名前を付け直せるタブか（ADR 0032）。
 *
 * **定義タブは付け直せない。**定義タブの名前はオブジェクトの名前そのもの
 * であり（ADR 0022）、変えられると「どのオブジェクトの定義か」がタブ帯から
 * 読めなくなる。加えて定義タブはセッションに保存されないため（ADR 0022）、
 * 付けた名前は再起動で必ず消える。
 *
 * @param tab 対象のタブ
 */
export function canRenameTab(tab: EditorTab): boolean {
  return isSqlTab(tab)
}

/**
 * タブの名前から `.sql` を落としたものを返す。
 *
 * 保存済みクエリの名前の既定値（`⇧⌘S`、ADR 0018）と CSV のファイル名に使う。
 * 付け直した名前があればそちらが元になる。名前を付けたタブから書き出した
 * CSV が `無題-3.csv` になるのでは、付けた意味が無い。
 *
 * @param tab 対象のタブ
 */
export function tabBaseName(tab: EditorTab): string {
  return tabDisplayName(tab).replace(/\.sql$/, '')
}

/**
 * ファイルの保存ダイアログに出す既定のファイル名を返す（`⌘S`）。
 *
 * 自動の名前（`無題-1.sql` / 開いたファイルのファイル名）は初めからファイル名の
 * 形をしているのでそのまま通る。利用者が付けた名前は日本語の見出しでありうる
 * ため、`.sql` を補い、パスの区切りだけは落とす（ダイアログの保存先が勝手に
 * 変わらないようにする）。
 *
 * @param tab 対象のタブ
 */
export function tabFileName(tab: EditorTab): string {
  return `${tabBaseName(tab).replace(/\//g, '-')}.sql`
}
