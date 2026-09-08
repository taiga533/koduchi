/**
 * SQL エディタ（CodeMirror 6）。
 *
 * 方言は接続種別に合わせる。Oracle を先に実装するため、現時点では Oracle 固定。
 *
 * 補完には取得済みのスキーマから組み立てたカタログを渡す（ADR 0007・0013）。
 * 候補の組み立ては `sqlCompletion.ts` の自前のソースが行い、`lang-sql` へは
 * キーワードの補完だけを任せる。カタログは段階的に読み込まれるため、届くたびに
 * `Compartment` で言語設定だけを差し替える。エディタを作り直すと取り消し履歴と
 * カーソル位置が飛ぶ。
 *
 * 実行（`⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎`）と中止（`⌘.`）、検索・置換（`⌘F` / `⌘G` /
 * `⇧⌘G` / `⌥⌘F`）はエディタの中でしか意味を持たないため、`App.tsx` の `keydown`
 * ではなく CodeMirror の keymap に置く。検索の中身は `search.tsx` にある。
 *
 * 日本語入力（IME）の変換中はエディタの外へ何も伝えない。変換中に React の
 * 再描画を起こすと、CodeMirror が編集領域の DOM を組み直し、その拍子に
 * 入力ソースの表示が切り替わって画面中央にインジケータが出る。確定した時点で
 * まとめて 1 度だけ伝えれば足りる。
 */

import type { Ref } from 'react'
import { useEffect, useImperativeHandle, useRef } from 'react'
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
import { sql } from '@codemirror/lang-sql'
import type { IdentifierCase } from '../../types/db'
import type { Catalog } from './catalog'
import { koduchiOracleDialect } from './dialect'
import { withLeadingSpace } from './insertion'
import { sqlCompletionSource } from './sqlCompletion'
import { koduchiEditorTheme } from './theme'
import { koduchiSearch, koduchiSearchKeymap } from './search'

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
 * 外から呼べるエディタの操作（ADR 0020）。
 *
 * スキーマツリーからの挿入のために開けてある口である。内容をタブストア越しに
 * 差し替える手もあるが、それでは文書を丸ごと置き換えることになり、カーソルが
 * 末尾へ飛ぶうえ取り消し履歴が 1 段で潰れる。CodeMirror へ差分として渡す。
 */
export interface SqlEditorHandle {
  /**
   * カーソル位置へ文字列を挿入する。選択があればその範囲を置き換える。
   *
   * 直前の文字を見て、要るときだけ空白を足す（`insertion.ts`）。**焦点は
   * 移さない。**続けて別の名前を入れる操作が多く、そのたびに焦点がエディタへ
   * 飛ぶと、ツリーへ戻る手間が挿入の手間を上回る。
   */
  insertAtCursor: (text: string) => void
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

/**
 * 言語まわりの拡張を組み立てる。
 *
 * `sql()` にはスキーマを渡さない。渡すと `lang-sql` の補完ソースが有効になり、
 * 大文字小文字を区別する階層解決と引用符付きの挿入が復活する（ADR 0013）。
 * ここから受け取るのはキーワードの補完だけで、識別子の候補は自前のソースが出す。
 *
 * @param catalog 補完に使うカタログ
 * @param identifierCase 挿入する識別子の綴り
 */
function languageFor(catalog: Catalog, identifierCase: IdentifierCase) {
  return [
    sql({ dialect: koduchiOracleDialect, upperCaseKeywords: false }),
    koduchiOracleDialect.language.data.of({
      autocomplete: sqlCompletionSource(catalog, identifierCase),
    }),
  ]
}

interface SqlEditorProps {
  /** 外から挿入するための口（ADR 0020）。 */
  ref?: Ref<SqlEditorHandle>
  /** エディタの内容。 */
  value: string
  /**
   * 補完に使うカタログ（ADR 0013）。
   *
   * 呼び出し側で記憶しておくこと。参照が変わるたびに言語設定を作り直す。
   */
  catalog: Catalog
  /** 補完で挿入する識別子の綴り。接続ごとの設定（ADR 0013）。 */
  identifierCase: IdentifierCase
  /** 内容が変わったときに呼ばれる。変換中は呼ばれず、確定時にまとめて呼ばれる。 */
  onChange: (value: string) => void
  /** カーソル位置や選択が変わったときに呼ばれる。 */
  onCursorChange: (position: EditorPosition) => void
  /** `⌘⏎`。カーソル位置の文を実行する。 */
  onRunStatement: () => void
  /** `⇧⌘⏎`。選択範囲を実行する。 */
  onRunSelection: () => void
  /** `⌥⌘⏎`。タブ全体（選択範囲があればその中）の文を順に実行する。 */
  onRunScript: () => void
  /** `⌘.`。実行を中止する。 */
  onCancel: () => void
}

export function SqlEditor({
  ref,
  value,
  catalog,
  identifierCase,
  onChange,
  onCursorChange,
  onRunStatement,
  onRunSelection,
  onRunScript,
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
  const handlers = useRef({
    onChange,
    onCursorChange,
    onRunStatement,
    onRunSelection,
    onRunScript,
    onCancel,
  })
  handlers.current = {
    onChange,
    onCursorChange,
    onRunStatement,
    onRunSelection,
    onRunScript,
    onCancel,
  }

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        const editor = view.current
        if (!editor) {
          return
        }

        const range = editor.state.selection.main
        const insert = withLeadingSpace(
          text,
          range.from === 0 ? '' : editor.state.sliceDoc(range.from - 1, range.from),
        )
        editor.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: { anchor: range.from + insert.length },
          scrollIntoView: true,
        })
      },
    }),
    [],
  )

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
        language.current.of(languageFor(catalog, identifierCase)),
        autocompletion(),
        // 補完の候補は編集領域の外（本体直下）へ出す。編集領域の中に足し引きすると、
        // 入力の最中に DOM が動いて変換に割り込む。
        tooltips({ parent: document.body }),
        koduchiSearch,
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
            key: 'Alt-Mod-Enter',
            preventDefault: true,
            run: () => {
              handlers.current.onRunScript()
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
          // 検索は `defaultKeymap` より前に置く。`⌘F` を確実に取るため。
          ...koduchiSearchKeymap,
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

  // カタログが届いたら補完の元だけを差し替える。
  useEffect(() => {
    view.current?.dispatch({
      effects: language.current.reconfigure(languageFor(catalog, identifierCase)),
    })
  }, [catalog, identifierCase])

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
