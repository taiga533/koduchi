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
})

/** エディタのテーマ一式。 */
export const koduchiEditorTheme: Extension = [editorTheme, syntaxHighlighting(highlightStyle)]
