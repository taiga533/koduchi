/**
 * CodeMirror のテーマ（ADR 0008）。
 *
 * 色は値を持たず `theme/tokens.css` の CSS 変数を参照する。ルート要素の
 * `data-theme` 属性が変われば、エディタの配色も一緒に切り替わる。
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView, drawSelection } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { FLASH_DURATION_MS } from './statementRange'

/**
 * 流した文を光らせる地の色（ADR 0047）。
 *
 * アクセントを薄めて使う。新しいトークンを足さないのは、「今流したもの」を
 * 示す色はアクセントそのものであり、ライトとダークの両方で `--ac` が既に
 * 決めてあるためである。
 */
const FLASH_BACKGROUND = 'color-mix(in srgb, var(--ac) 24%, transparent)'

/** 光を消していくアニメーション。交互の class に別の名前で当てる（`statementRange.ts`）。 */
const flashKeyframes = {
  from: { backgroundColor: FLASH_BACKGROUND },
  to: { backgroundColor: 'transparent' },
}

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
    padding: '10px 0',
    caretColor: 'var(--fg)',
  },
  /*
   * 横の余白は `.cm-content` ではなく行に持たせる。`drawSelection` は行の
   * `padding-left` から選択の矩形を描き始めるため、`.cm-content` 側に置くと
   * 複数行の選択が文字の左へ 14px はみ出す（issue #54）。値は既定の
   * `0 2px 0 6px` に元の 14px を足したもので、文字の位置は変わらない。
   */
  '.cm-line': {
    padding: '0 16px 0 20px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--panel)',
    color: 'var(--fg6)',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
  },
  /*
   * 右の余白は縦線の溝（3px）のぶんだけ詰め、本文の位置を変えない。
   */
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 9px 0 14px',
    minWidth: '30px',
  },
  /*
   * `⌘⏎` で流れる文の縦線（ADR 0047）。溝は常に同じ幅を取る。カーソルが
   * 動くたびに溝が出たり消えたりすると、本文が横へずれる。
   */
  '.cm-runRangeGutter': {
    width: '3px',
  },
  '.cm-runRange': {
    position: 'relative',
  },
  '.cm-runRange::before': {
    content: '""',
    position: 'absolute',
    left: '0',
    width: '2px',
    top: '0',
    bottom: '0',
    backgroundColor: 'var(--ac)',
    opacity: '0.6',
  },
  // 文の端の行だけ縦線を行の内側へ縮め、隣の文の縦線と繋がって見えないようにする。
  '.cm-runRange-first::before, .cm-runRange-only::before': {
    top: '3px',
    borderTopLeftRadius: '1px',
    borderTopRightRadius: '1px',
  },
  '.cm-runRange-last::before, .cm-runRange-only::before': {
    bottom: '3px',
    borderBottomLeftRadius: '1px',
    borderBottomRightRadius: '1px',
  },
  '.cm-runFlash-a': {
    animation: `koduchi-run-flash-a ${FLASH_DURATION_MS}ms ease-out`,
  },
  '.cm-runFlash-b': {
    animation: `koduchi-run-flash-b ${FLASH_DURATION_MS}ms ease-out`,
  },
  '@keyframes koduchi-run-flash-a': flashKeyframes,
  '@keyframes koduchi-run-flash-b': flashKeyframes,
  /*
   * 動きを減らす設定では消えていく動きを見せず、光らせている間だけ地を敷く。
   * 何が流れたかを示すこと自体は動きではないため、やめはしない。
   */
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-runFlash': {
      animation: 'none',
      backgroundColor: FLASH_BACKGROUND,
    },
  },
  '.cm-gutters .cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--fg4)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  /*
   * 選択の地は `drawSelection` の層が描く（issue #54）。焦点のあるときの選択子は
   * `@codemirror/view` の基底テーマ（`&light.cm-focused > .cm-scroller >
   * .cm-selectionLayer .cm-selectionBackground`）と同じ強さにそろえる。弱いと
   * 焦点のある間だけ基底の薄紫が勝つ。
   */
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    {
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

/**
 * エディタのテーマ一式。
 *
 * `drawSelection` をここへ含めるのは、選択の色（`.cm-selectionBackground`）が
 * その層にしか当たらないためである。素のままでは WebKit の `::selection` が
 * 文字の高さだけを塗り、行の高さ 1.7 の余りが行と行の間のすき間として残る
 * （issue #54）。`drawSelection` は行の箱の高さで矩形を描くため、文字の大きさ
 * （`data-editor-font-size`）が変わってもすき間は生まれない。
 */
export const koduchiEditorTheme: Extension = [
  drawSelection(),
  editorTheme,
  syntaxHighlighting(highlightStyle),
]
