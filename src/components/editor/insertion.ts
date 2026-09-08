/**
 * スキーマツリーからエディタへ入れる文字列を組み立てる（ADR 0020）。
 *
 * 綴りと引用符の決まりは自前で書き直さない。`identifiers.ts` の
 * `styleIdentifier` へ丸ごと委ねる（ADR 0013）。**引用符は必要なときだけ付け、
 * 付けるときは綴りを変えない。**ツリーから入れる名前と補完が入れる名前が
 * 食い違うと、同じ表が 2 通りの綴りで 1 つの SQL に並ぶ。
 *
 * 組み立てと挿入は分けてある。ここは文字列を作るだけの純粋な関数で、
 * どこへ差し込むかは `SqlEditor` の `insertAtCursor` が決める。
 */

import type { IdentifierCase } from '../../types/db'
import { styleIdentifier } from './identifiers'

/**
 * 直前に空白を足さなくてよい文字。
 *
 * - 開き括弧: `count(` の直後に空白を挟むと、書き手の意図から離れる。
 * - ピリオド: `koduchi.` まで打った位置は修飾の途中であり、空白は名前を壊す。
 * - コロン: `:id` のバインド変数と同じく、区切ってはいけない前置きである。
 */
const NO_SPACE_AFTER = new Set(['(', '.', ':'])

/**
 * 名前の並びを、挿入する 1 つの綴りへ組み立てる。
 *
 * `["KODUCHI", "USERS"]` は `koduchi.users`（綴りが小文字のとき）になる。
 * 引用符が要る名前は要素ごとに囲むため、`"MyTable"` を含む並びは
 * `koduchi."MyTable"` の形になる。修飾のいらない列は要素 1 つで呼ぶ。
 *
 * @param names カタログが持っている綴りの名前を、外側から並べたもの
 * @param style 挿入したい綴り（接続ごとの設定。ADR 0013）
 */
export function qualifiedIdentifier(names: string[], style: IdentifierCase): string {
  return names
    .map((name) => {
      const styled = styleIdentifier(name, style)
      return styled.apply ?? styled.label
    })
    .join('.')
}

/**
 * 挿入する文字列の前に、要るときだけ空白を 1 つ足す。
 *
 * 空白を足さないと `where` の直後へ入れた名前が `whereusers` になる。逆に
 * いつでも足すと、行頭や `(` の直後に不要な空白が残る。**直前の文字だけで
 * 決める。**カーソルの手前が何であるかは、文の構造を読まなくても分かる。
 *
 * @param text 挿入する文字列
 * @param precedingChar カーソルの直前の 1 文字。文書の先頭では空文字列
 */
export function withLeadingSpace(text: string, precedingChar: string): string {
  if (precedingChar === '' || /\s/.test(precedingChar) || NO_SPACE_AFTER.has(precedingChar)) {
    return text
  }
  return ` ${text}`
}

/**
 * 表・ビュー・マテビューの中身を見るための問い合わせを組み立てる。
 *
 * キーワードは小文字で書く。エディタのキーワード補完が小文字固定であり
 * （`upperCaseKeywords: false`）、識別子の綴りとは別の話だからである（ADR 0013）。
 * 文末の `;` は付けない。1 文だけを入れた新しいタブであり、`⌘⏎` は区切りが
 * 無くても文を切り出せる。
 *
 * @param names `[スキーマ名, オブジェクト名]`
 * @param style 挿入したい綴り
 */
export function selectAllStatement(names: string[], style: IdentifierCase): string {
  return `select * from ${qualifiedIdentifier(names, style)}`
}
