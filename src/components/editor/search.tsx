/**
 * エディタの検索・置換（`@codemirror/search`）。
 *
 * 数百行の SQL を扱う以上、`⌘F` は無いと道具として成立しない。素の検索パネルを
 * そのまま出すと英語の文言と字送り任せの `×` がこのアプリの意匠から浮くため、
 * ここで 3 つだけ手を入れる。
 *
 * 1. 文言は `EditorState.phrases` で日本語へ差し替える（`search()` の設定では
 *    なく状態側のファセットが文言の出どころである）。
 * 2. 閉じるボタンの `×` は lucide のアイコンへ挿げ替える（CLAUDE.md「アイコン」）。
 *    パネルは CodeMirror が素の DOM で組むため、そこへ小さな React の根を 1 つ
 *    生やして描く。
 * 3. 日本語入力（IME）の変換中の打鍵をパネルへ渡さない（ADR 0025）。止める
 *    理由は 2 つある。
 *
 *    - `keyup`: 素の検索欄は `keyup` のたびに問い合わせを作り直すので、その
 *      ままでは変換中の未確定な文字列でも検索が走り、候補を選んでいる間ずっと
 *      強調が飛び回る。
 *    - `keydown`: パネルは `esc` を自前の `keydown` で受けて閉じる。変換を
 *      取り消すつもりの `esc` で**打ちかけの検索語ごとパネルが消える**。
 *
 *    **本文（`contentDOM`）側にこの手当ては要らない。**`@codemirror/view` の
 *    `ignoreDuringComposition` が変換中の打鍵を既に捨てており、WebKit で
 *    `compositionend` の後に `⏎` が届く癖まで面倒を見ている。それが効くのは
 *    エディタ本文に属する打鍵だけで、**パネルは対象外**である。だからここだけ
 *    塞ぐ。
 *
 * 見た目そのもの（背景・枠線・入力欄・ボタン）は `theme.ts` の
 * `koduchiEditorTheme` がトークン経由で与える。ここでは色を持たない。
 */

import { createRoot, type Root } from 'react-dom/client'
import { EditorState, type Extension } from '@codemirror/state'
import {
  ViewPlugin,
  type Command,
  type EditorView,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view'
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search'
import { X } from 'lucide-react'
import { isComposingKey } from '../../input/ime'

/**
 * 検索パネルの文言。
 *
 * 左辺は `@codemirror/search` が `state.phrase()` に渡す英語の原文であり、
 * 変えてはいけない。`Replace`（置換欄のプレースホルダ）と `replace`（置換
 * ボタン）のように大小だけが違うものが混じるため、対で書いてある。
 */
const 検索パネルの文言: Record<string, string> = {
  Find: '検索',
  next: '次へ',
  previous: '前へ',
  all: 'すべて選択',
  'match case': '大文字と小文字を区別',
  regexp: '正規表現',
  'by word': '単語単位',
  Replace: '置換後の文字列',
  replace: '置換',
  'replace all': 'すべて置換',
  close: '閉じる',
  'current match': '現在の一致',
  'Go to line': '行へ移動',
  go: '移動',
  'on line': '行',
}

/** 検索パネルの中で、置換欄を持つ入力要素を取り出す。無ければ `null`。 */
function 置換欄(パネル: HTMLElement): HTMLInputElement | null {
  return パネル.querySelector<HTMLInputElement>('input[name="replace"]')
}

/**
 * `⌥⌘F`。検索パネルを開き、置換欄へ入力の焦点を移す。
 *
 * `@codemirror/search` は置換だけを開く命令を持たない。パネルは
 * `openSearchPanel` の差し込みと同じ回で組み上がるので、その場で置換欄を掴める。
 * 読み取り専用のときは置換欄そのものが作られないため、検索を開くに留める。
 */
const 置換を開く: Command = (view) => {
  openSearchPanel(view)
  const パネル = view.dom.querySelector<HTMLElement>('.cm-search')
  const 欄 = パネル ? 置換欄(パネル) : null
  欄?.focus()
  欄?.select()
  return true
}

/**
 * 検索と置換のキーバインド。
 *
 * `⌘F` 検索 / `⌘G` 次へ / `⇧⌘G` 前へ（この 3 つは `searchKeymap` の既定）に
 * `⌥⌘F` 置換を足したもの。`defaultKeymap` より前に置くこと。
 */
export const koduchiSearchKeymap: readonly KeyBinding[] = [
  { key: 'Mod-Alt-f', run: 置換を開く, preventDefault: true },
  ...searchKeymap,
]

/**
 * 変換中の打鍵を入力欄とパネルへ届く前に止める（ADR 0025）。
 *
 * `@codemirror/search` は入力欄の `keyup` ごとに検索の問い合わせを作り直し、
 * `esc` はパネルの `keydown` で受けて閉じる。どちらの処理もパネルとその中の
 * 入力欄に載っているので、1 つ上のパネルで捕捉相をつかまえて伝播を止める。
 *
 * **`preventDefault()` は使わない。**変換の確定そのものへ影響しかねないうえ、
 * ここで要るのは「パネルに横取りさせない」ことだけである。文字が入る既定の
 * 動作はそのまま残る。変換が確定した後の打鍵と `change` は通るため、確定した
 * 語で検索が走り、`esc` でパネルが閉じる。
 *
 * 後片付けのための関数を返す。
 */
function 変換中の打鍵を止める(パネル: HTMLElement): () => void {
  パネル.addEventListener('keyup', 変換中なら止める, true)
  パネル.addEventListener('keydown', 変換中なら止める, true)
  return () => {
    パネル.removeEventListener('keyup', 変換中なら止める, true)
    パネル.removeEventListener('keydown', 変換中なら止める, true)
  }
}

/**
 * 変換中の打鍵だけ伝播を止める。上の説明を参照。
 *
 * 判定は `isComposingKey` に任せる。変換の**途中**は `isComposing` が真で
 * 届くが、変換を**確定する** `⏎` は `isComposing` が偽・`keyCode` が 229 で
 * 届くためである（ADR 0025 の「1-2」）。
 */
function 変換中なら止める(event: Event): void {
  if (event instanceof KeyboardEvent && isComposingKey(event)) {
    event.stopPropagation()
  }
}

/**
 * 閉じるボタンの `×` を lucide のアイコンへ挿げ替える。
 *
 * 返り値の React の根は、パネルが消えるときに呼び出し側が畳む。
 */
function 閉じるボタンを整える(パネル: HTMLElement): Root | null {
  const ボタン = パネル.querySelector<HTMLButtonElement>('button[name="close"]')
  if (!ボタン) {
    return null
  }
  ボタン.textContent = ''
  const 根 = createRoot(ボタン)
  根.render(<X size={13} />)
  return 根
}

/**
 * 検索パネルが現れるたびに手直しを施すビュープラグイン。
 *
 * パネルは開閉のたびに作り直されるため、要素の同一性を見て張り替える。
 */
const 検索パネルの手直し = ViewPlugin.fromClass(
  class {
    /** 直前に手を入れたパネル。開いていなければ `null`。 */
    private パネル: HTMLElement | null = null
    /** 閉じるボタンへ生やした React の根。 */
    private 根: Root | null = null
    /** 変換中の打鍵を止める仕掛けの後片付け。 */
    private 打鍵の後始末: (() => void) | null = null

    constructor(view: EditorView) {
      this.同期する(view)
    }

    update(update: ViewUpdate) {
      this.同期する(update.view)
    }

    destroy() {
      this.片付ける()
    }

    /** 今出ているパネルと手直しの状態を合わせる。 */
    private 同期する(view: EditorView) {
      const パネル = view.dom.querySelector<HTMLElement>('.cm-search')
      if (パネル === this.パネル) {
        return
      }
      this.片付ける()
      this.パネル = パネル
      if (!パネル) {
        return
      }
      this.打鍵の後始末 = 変換中の打鍵を止める(パネル)
      this.根 = 閉じるボタンを整える(パネル)
    }

    /** 前のパネルへ生やした React の根を畳む。 */
    private 片付ける() {
      this.打鍵の後始末?.()
      this.打鍵の後始末 = null
      const 根 = this.根
      this.根 = null
      this.パネル = null
      // 描画の最中に畳むと React が警告を出すため、1 拍置く。
      if (根) {
        queueMicrotask(() => 根.unmount())
      }
    }
  },
)

/**
 * 検索・置換の拡張一式。
 *
 * パネルは編集領域の上（`top: true`）に出す。下に出すと結果テーブルとの境目に
 * 重なって、どちらの持ち物か分からなくなる。
 */
export const koduchiSearch: Extension = [
  search({ top: true }),
  highlightSelectionMatches(),
  EditorState.phrases.of(検索パネルの文言),
  検索パネルの手直し,
]
