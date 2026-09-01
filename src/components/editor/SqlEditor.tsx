/**
 * SQL エディタ（CodeMirror 6）。
 *
 * 方言は接続種別に合わせる。Oracle を先に実装するため、現時点では Oracle 固定。
 *
 * 補完には取得済みのスキーマを渡す（ADR 0007）。スキーマは段階的に読み込まれる
 * ため、届くたびに `Compartment` で言語設定だけを差し替える。エディタを作り直すと
 * 取り消し履歴とカーソル位置が飛ぶ。
 *
 * 日本語入力（IME）の変換中はエディタの外へ何も伝えない。変換中に React の
 * 再描画を起こすと、CodeMirror が編集領域の DOM を組み直し、その拍子に
 * 入力ソースの表示が切り替わって画面中央にインジケータが出る。確定した時点で
 * まとめて 1 度だけ伝えれば足りる。
 */

import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  tooltips,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { PLSQL, sql } from '@codemirror/lang-sql'
import { koduchiEditorTheme } from './theme'

/** エディタのカーソルと選択の状態。 */
export interface EditorPosition {
  /** 1 始まりの行番号。 */
  line: number
  /** 1 始まりの桁。 */
  column: number
  /** 文書の先頭からの文字数。文の切り出しに使う。 */
  offset: number
  /** 選択されている文字列。選択が無ければ `null`。 */
  selectedText: string | null
}

/**
 * 編集領域に付ける属性。
 *
 * 綴り検査と自動修正・自動大文字化を切る。SQL に対しては誤りしか生まないうえ、
 * 日本語入力と重なると変換の邪魔になる。
 */
const CONTENT_ATTRIBUTES = {
  spellcheck: 'false',
  autocorrect: 'off',
  autocapitalize: 'off',
}

interface SqlEditorProps {
  /** エディタの内容。 */
  value: string
  /**
   * 補完に使うスキーマ。`{ テーブル名: 列名の並び }` の形。
   *
   * 呼び出し側で記憶しておくこと。参照が変わるたびに言語設定を作り直す。
   */
  schema: Record<string, string[]>
  /** 内容が変わったときに呼ばれる。変換中は呼ばれず、確定時にまとめて呼ばれる。 */
  onChange: (value: string) => void
  /** カーソル位置や選択が変わったときに呼ばれる。 */
  onCursorChange: (position: EditorPosition) => void
  /** `⌘⏎`。カーソル位置の文を実行する。 */
  onRunStatement: () => void
  /** `⇧⌘⏎`。選択範囲を実行する。 */
  onRunSelection: () => void
  /** `⌘.`。実行を中止する。 */
  onCancel: () => void
}

export function SqlEditor({
  value,
  schema,
  onChange,
  onCursorChange,
  onRunStatement,
  onRunSelection,
  onCancel,
}: SqlEditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 言語設定だけを差し替えるための仕切り。
  const language = useRef(new Compartment())
  /**
   * 最後にエディタ自身が外へ伝えた内容。
   *
   * 打鍵で伝えた内容がそのまま `value` として返ってくる。それを「外からの
   * 差し替え」と取り違えて書き戻すと、編集領域の DOM を無駄に組み直す。
   */
  const emitted = useRef(value)

  // 各コールバックは再描画のたびに新しくなるため、拡張を作り直さずに済むよう
  // ref 越しに最新のものを呼ぶ。
  const handlers = useRef({ onChange, onCursorChange, onRunStatement, onRunSelection, onCancel })
  handlers.current = { onChange, onCursorChange, onRunStatement, onRunSelection, onCancel }

  useEffect(() => {
    if (!container.current) {
      return
    }

    /** 変換中に溜まった変更を、確定後に伝えるための目印。 */
    let 変換中に変更があった = false

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        language.current.of(sql({ dialect: PLSQL, schema, upperCaseKeywords: false })),
        autocompletion(),
        // 補完の候補は編集領域の外（本体直下）へ出す。編集領域の中に足し引きすると、
        // 入力の最中に DOM が動いて変換に割り込む。
        tooltips({ parent: document.body }),
        koduchiEditorTheme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of(CONTENT_ATTRIBUTES),
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              handlers.current.onRunStatement()
              return true
            },
          },
          {
            key: 'Shift-Mod-Enter',
            preventDefault: true,
            run: () => {
              handlers.current.onRunSelection()
              return true
            },
          },
          {
            key: 'Mod-.',
            preventDefault: true,
            run: () => {
              handlers.current.onCancel()
              return true
            },
          },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          // 変換中は外へ伝えない。伝えた先の再描画がこの領域の DOM を揺らす。
          if (update.view.composing) {
            変換中に変更があった = 変換中に変更があった || update.docChanged
            return
          }

          if (update.docChanged || 変換中に変更があった) {
            変換中に変更があった = false
            const doc = update.state.doc.toString()
            emitted.current = doc
            handlers.current.onChange(doc)
          }

          if (update.selectionSet || update.docChanged) {
            const range = update.state.selection.main
            const line = update.state.doc.lineAt(range.head)
            handlers.current.onCursorChange({
              line: line.number,
              column: range.head - line.from + 1,
              offset: range.head,
              selectedText: range.empty ? null : update.state.sliceDoc(range.from, range.to),
            })
          }
        }),
      ],
    })

    const editor = new EditorView({ state, parent: container.current })
    view.current = editor

    return () => {
      editor.destroy()
      view.current = null
    }
    // 初期化は 1 度きり。以後の内容の同期は下の効果で行う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // スキーマが届いたら補完の元だけを差し替える。
  useEffect(() => {
    view.current?.dispatch({
      effects: language.current.reconfigure(
        sql({ dialect: PLSQL, schema, upperCaseKeywords: false }),
      ),
    })
  }, [schema])

  // 外から内容が差し替わったとき（履歴からの流し込みなど）にエディタへ反映する。
  //
  // 自分が伝えた内容が返ってきただけなら何もしない。変換中も何もしない
  // （未確定の文字列ごと消えて入力が壊れる）。
  useEffect(() => {
    const editor = view.current
    if (!editor || value === emitted.current || editor.composing) {
      return
    }

    emitted.current = value
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    })
  }, [value])

  return <div ref={container} className="h-full overflow-hidden" />
}
