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
 * 行の高さ 1.7 と 12px の等幅は、デザインのエディタ領域の指定に合わせてある。
 */
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
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
    fontSize: '12px',
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
})

/** エディタのテーマ一式。 */
export const koduchiEditorTheme: Extension = [editorTheme, syntaxHighlighting(highlightStyle)]
