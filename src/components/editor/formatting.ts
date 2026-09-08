/**
 * 整形をエディタの本文へ当てる（ADR 0024）。
 *
 * **この入口の持ち主はここ 1 つ**である。どの打鍵で始まるか（`⇧⌥F`）と、
 * その結果として本文のどこをどう書き換えるかを決める。整形そのものは
 * `src/sql/format.ts` が持ち、ここは「どこへ当てるか」だけを担う。
 *
 * 書き換えは**差分**として返す。本文を丸ごと置き換えるとカーソルが末尾へ飛び、
 * 取り消しも 1 段で潰れる（ADR 0020 と同じ理由）。CodeMirror へ渡すのは
 * `SqlEditor` の役目であり、ここは位置と文字列を組み立てるだけの純粋な関数に
 * してある。
 */

import { formatSql, type FormatFailureReason } from '../../sql/format'

/** 本文へ当てる 1 か所の書き換え。 */
export interface FormatEdit {
  /** 置き換える範囲の始まり。 */
  from: number
  /** 置き換える範囲の終わり（この位置の文字は含まない）。 */
  to: number
  /** 置き換えた後の文字列。 */
  insert: string
  /**
   * 整形し終えた範囲（書き換えを当てた後の位置）。
   *
   * 選択範囲を整形したときに、同じ範囲を選び直すために使う。`from`〜`to` は
   * 前後の変わらない部分を削った**差分**であり、整形した範囲とは一致しない。
   */
  region: { from: number; to: number }
}

/** 整形を当てた結果。 */
export type FormatEditOutcome =
  /** この書き換えを当ててよい。 */
  | { status: 'edit'; edit: FormatEdit }
  /** 当てるものが無い。既に整形済みか、中身が空である。 */
  | { status: 'unchanged' }
  /** 整形できなかった。**本文には触れないこと。** */
  | { status: 'failed'; reason: FormatFailureReason; message: string }

/**
 * `⇧⌥F`（整形）の打鍵かどうかを判定する。
 *
 * **`event.key` ではなく `event.code` で見る。**macOS では `⌥` を伴う打鍵が
 * 文字そのものを変えてしまう（US 配列でも JIS 配列でも `⇧⌥F` は `Ï` になる）。
 * CodeMirror の keymap も、mac で `⌥` だけが付いた組み合わせについては配列に
 * 依らない名前へ戻す道を**わざと閉じている**（`Alt` 付きの打鍵は文字入力である
 * ことが多いため）。そのため `Shift-Alt-f` という名前では捕まらない。
 *
 * `code` は打った物理キーであり配列に依らないので、US でも JIS でも同じに効く。
 * `⌥⌘F`（置換）や `⇧⌘F`（ソース検索）と食い合わないよう、`⌘` と `⌃` が
 * 付いているものは除く。
 *
 * @param event 判定する打鍵
 */
export function isFormatShortcut(event: {
  code: string
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return event.code === 'KeyF' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
}

/**
 * 選択範囲を整形するときの、行頭の下げ幅を求める。
 *
 * 選択範囲を単体の SQL として整形すると行頭が左端へ寄り、周りのインデントから
 * 浮く。2 行目以降にこの下げ幅を足して周りへ揃える。
 *
 * 求め方は「選択の始まりが行のどこにあるか」で決まる。
 *
 * - 行頭から選択の始まりまでが空白だけなら、**その空白**を下げ幅にする。
 *   選択した塊はもともとその位置に置かれていたのだから、そこへ揃うのが自然である。
 * - 手前に文字があるなら（`... from (|ここから|)` のような選び方）、**その行の
 *   行頭の空白**を下げ幅にする。塊の途中の位置へ揃えると、行が右へ流れていく。
 *
 * @param doc 本文の全文
 * @param from 選択範囲の始まり
 *
 * @returns 2 行目以降の頭に足す空白
 */
export function selectionIndent(doc: string, from: number): string {
  const lineStart = doc.lastIndexOf('\n', from - 1) + 1
  const beforeSelection = doc.slice(lineStart, from)

  if (/^[ \t]*$/.test(beforeSelection)) {
    return beforeSelection
  }

  return /^[ \t]*/.exec(doc.slice(lineStart))?.[0] ?? ''
}

/**
 * 2 行目以降の頭に空白を足す。
 *
 * 空行には足さない。足すと目に見えない空白が行末に残る。
 *
 * @param text 整形した結果
 * @param indent 足す空白
 */
export function indentContinuationLines(text: string, indent: string): string {
  if (indent === '') {
    return text
  }

  return text
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : indent + line))
    .join('\n')
}

/** 上位のサロゲート（この符号単位の直後にもう 1 単位が続く）。 */
const HIGH_SURROGATE = /[\uD800-\uDBFF]/

/** 下位のサロゲート（この符号単位の直前にもう 1 単位がある）。 */
const LOW_SURROGATE = /[\uDC00-\uDFFF]/

/**
 * 書き換えの前後から、変わらない部分を削る。
 *
 * 整形は本文の広い範囲を対象にするが、実際に変わるのはその一部であることが
 * 多い。丸ごと置き換えるとカーソルが範囲の末尾へ飛ぶ。**変わった所だけを
 * 差分として渡せば、変わらなかった所に居るカーソルはそのまま残る**
 * （ADR 0020 と同じ考え）。
 *
 * 前後を削る位置がサロゲートペアの間に落ちないよう、1 単位ぶん戻す。絵文字や
 * 一部の漢字を半分に割ると、そこから先の文字が壊れる。
 *
 * @param before 置き換える前の文字列
 * @param after 置き換えた後の文字列
 *
 * @returns 前後で削った長さ
 */
export function unchangedEnds(before: string, after: string): { prefix: number; suffix: number } {
  const shortest = Math.min(before.length, after.length)

  let prefix = 0
  while (prefix < shortest && before[prefix] === after[prefix]) {
    prefix += 1
  }
  if (prefix > 0 && HIGH_SURROGATE.test(before[prefix - 1])) {
    prefix -= 1
  }

  let suffix = 0
  while (
    suffix < shortest - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  if (suffix > 0 && LOW_SURROGATE.test(before[before.length - suffix])) {
    suffix -= 1
  }

  return { prefix, suffix }
}

/**
 * 本文へ当てる書き換えを組み立てる（`⇧⌥F`）。
 *
 * **選択範囲があればその範囲だけ、なければ本文全体を整形する。**選択範囲の
 * ときは 2 行目以降を周りのインデントへ揃える。
 *
 * @param doc 本文の全文
 * @param from 選択範囲の始まり。選択が無ければカーソル位置
 * @param to 選択範囲の終わり。選択が無ければ `from` と同じ
 *
 * @returns 当てる書き換え、または当てられない理由
 */
export function formatEdit(doc: string, from: number, to: number): FormatEditOutcome {
  const hasSelection = from !== to
  const start = hasSelection ? from : 0
  const end = hasSelection ? to : doc.length
  const source = doc.slice(start, end)

  const outcome = formatSql(source)
  if (outcome.status !== 'formatted') {
    return outcome
  }

  const insert = hasSelection
    ? indentContinuationLines(outcome.text, selectionIndent(doc, from))
    : outcome.text

  if (insert === source) {
    return { status: 'unchanged' }
  }

  const { prefix, suffix } = unchangedEnds(source, insert)

  return {
    status: 'edit',
    edit: {
      from: start + prefix,
      to: end - suffix,
      insert: insert.slice(prefix, insert.length - suffix),
      region: { from: start, to: start + insert.length },
    },
  }
}
