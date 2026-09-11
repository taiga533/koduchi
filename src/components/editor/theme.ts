/**
 * CodeMirror のテーマ（ADR 0008）。
 *
 * 色は値を持たず `theme/tokens.css` の CSS 変数を参照する。ルート要素の
 * `data-theme` 属性が変われば、エディタの配色も一緒に切り替わる。
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/** SQL の字句に割り当てる色。デザインの `--kw` などをそのまま使う。 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--kw)', fontWeight: '600' },
  { tag: tags.operatorKeyword, color: 'var(--kw)', fontWeight: '600' },
  { tag: tags.modifier, color: 'var(--kw)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--str)' },
  { tag: tags.special(tags.string), color: 'var(--str)' },
  { tag: tags.number, color: 'var(--num)' },
  { tag: tags.bool, color: 'var(--num)' },
  { tag: tags.null, color: 'var(--num)' },
  { tag: tags.function(tags.variableName), color: 'var(--fn)' },
  { tag: tags.comment, color: 'var(--cmt)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--cmt)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--cmt)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--err)' },
])

/**
 * エディタの見た目。
 *
 * 行の高さ 1.7 と等幅は、デザインのエディタ領域の指定に合わせてある。文字の
 * 大きさだけは設定で変わるため、値ではなく `tokens.css` の `--fs-editor` を
 * 参照する（ADR 0008。既定はデザインどおりの 12px）。行の高さは倍率指定なので
 * 一緒に付いてくる。
 */
export const editorThemeSpec = {
  /*
   * **高さは `&` ではなく `&.cm-editor` に置く（issue #37）。**
   *
   * `SqlEditor` は補完の候補を編集領域の外へ出すため `tooltips({ parent:
   * document.body })` を使っている。`@codemirror/view` はこのとき本体直下に
   * 入れ物の `div` を 1 枚作り、**そこへエディタと同じテーマの class を付ける**
   * （`createContainer`。与えるのは `position: relative` と `themeClasses` だけ
   * である）。`&` はそのテーマの class そのものを指すため、`&` に高さを書くと
   * **この空の入れ物にも高さが付く。**本体の下にビューポート 1 枚ぶんの白い帯が
   * 生まれ、document がその分だけスクロールするようになる。
   *
   * `.cm-editor` は編集領域そのものにしか付かないため、併記すれば入れ物には
   * 当たらない。`fontSize` と `color` は入れ物に付いてよい（中に出る補完の
   * 候補がそれを継ぐ）ので `&` のままにしてある。**`&` へ寸法を書き足さない。**
   */
  '&.cm-editor': {
    height: '100%',
  },
  '&': {
    fontSize: 'var(--fs-editor)',
    color: 'var(--fg)',
    backgroundColor: 'var(--panel)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    padding: '10px 14px',
    caretColor: 'var(--fg)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--panel)',
    color: 'var(--fg6)',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 14px',
    minWidth: '30px',
  },
  '.cm-gutters .cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--fg4)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--fill2)',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: '9px',
    fontFamily: 'var(--font-mono)',
    // 補完の候補は本文と同じ綴りを見せるものなので、本文と同じ大きさで出す。
    fontSize: 'var(--fs-editor)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--fill2)',
    color: 'var(--fg)',
  },

  // 検索・置換パネル。素の CodeMirror は角ばった枠と OS 既定の入力欄を出すので、
  // 補完の吹き出しと同じ作法（`--panel` の地に `--line` の罫）へ寄せる。
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--fg)',
    border: 'none',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel.cm-search': {
    position: 'relative',
    padding: '7px 26px 7px 10px',
    backgroundColor: 'var(--panel2)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg2)',
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginLeft: '8px',
    color: 'var(--fg3)',
    fontSize: '11px',
  },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--ac)', margin: '0' },
  '.cm-textfield': {
    backgroundColor: 'var(--panel)',
    color: 'var(--fg)',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    padding: '3px 7px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    minWidth: '180px',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--ac)' },
  '.cm-button': {
    backgroundColor: 'var(--fill)',
    backgroundImage: 'none',
    color: 'var(--fg2)',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    padding: '3px 9px',
    marginLeft: '5px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--fill2)', color: 'var(--fg)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--fill2)' },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '6px',
    right: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--fg5)',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    backgroundColor: 'var(--fill2)',
    color: 'var(--fg2)',
  },

  // 一致箇所の強調。今いる 1 件だけをアクセント色で塗り、残りは淡く敷く。
  '.cm-searchMatch': { backgroundColor: 'var(--fill2)', outline: '1px solid var(--line)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ac)',
    color: 'var(--acfg)',
    outline: 'none',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--fill2)' },
}

const editorTheme = EditorView.theme(editorThemeSpec)

/** エディタのテーマ一式。 */
export const koduchiEditorTheme: Extension = [editorTheme, syntaxHighlighting(highlightStyle)]
