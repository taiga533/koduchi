/**
 * エディタと補完のまとまり。
 *
 * 打鍵のたびに描き直る範囲をこの中へ閉じ込める。内容も補完の元もここで購読し、
 * アプリのルートへは伝えない。ルートが打鍵ごとに描き直ると、サイドバーの
 * スキーマツリーと結果テーブルまで一緒に組み直され、文字の表示とカーソルの
 * 移動が目に見えて遅れる。
 */

import type { Ref } from 'react'
import { useCallback, useMemo } from 'react'
import { useConnectionStore } from '../../stores/connection'
import { useSchemaStore } from '../../stores/schema'
import { selectActiveSqlTab, useTabStore } from '../../stores/tab'
import type { TableColumn } from '../../types/db'
import { defaultCompletionSettings } from '../../types/db'
import { buildCatalog } from './catalog'
import { SqlEditor, type EditorPosition, type SqlEditorHandle } from './SqlEditor'

/** 列がまだ読み込まれていないときに渡す表。参照を固定して再計算を避ける。 */
const NO_COLUMNS: Record<string, TableColumn[]> = {}

interface EditorPanelProps {
  /**
   * エディタへ挿入するための口（ADR 0020）。
   *
   * スキーマツリーからの挿入に使う。そのまま `SqlEditor` へ渡すだけであり、
   * タブを切り替えると `key` で作り直されるので、口も張り替わる。
   */
  ref?: Ref<SqlEditorHandle>
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

/**
 * 選択中の SQL タブを SQL エディタへ繋ぐ。
 *
 * @param props 実行と中止の呼び出し口
 */
export function EditorPanel({
  ref,
  onCursorChange,
  onRunStatement,
  onRunSelection,
  onRunScript,
  onCancel,
}: EditorPanelProps) {
  // 定義タブを選んでいるときは何も描かない。定義タブにエディタは無い（ADR 0022）。
  const activeTab = useTabStore(selectActiveSqlTab)
  const updateContent = useTabStore((state) => state.updateContent)

  const schemas = useSchemaStore((state) => state.schemas)
  const schemaColumns = useSchemaStore((state) => state.columns)
  const columnsReady = useSchemaStore((state) => state.columnStatus === 'ready')

  // 非修飾で表名を出すのは接続したユーザーのスキーマだけにする（ADR 0013）。
  const username = useConnectionStore((state) => state.connection?.params.username ?? null)
  const identifierCase = useConnectionStore(
    (state) =>
      state.connection?.completion.identifierCase ?? defaultCompletionSettings.identifierCase,
  )

  /**
   * 補完の元。
   *
   * 列は読み込み終えてから 1 度だけ渡す。段階 2 の途中で差し替え続けると、
   * 候補が出ている最中に言語設定が作り直されてちらつく（ADR 0007）。
   */
  const readyColumns = columnsReady ? schemaColumns : NO_COLUMNS
  const catalog = useMemo(
    () => buildCatalog(schemas, readyColumns, username),
    [readyColumns, schemas, username],
  )

  const tabId = activeTab?.id ?? null
  const onChange = useCallback(
    (content: string) => {
      if (tabId) {
        updateContent(tabId, content)
      }
    },
    [tabId, updateContent],
  )

  if (!activeTab) {
    return null
  }

  return (
    <SqlEditor
      key={activeTab.id}
      ref={ref}
      value={activeTab.content}
      catalog={catalog}
      identifierCase={identifierCase}
      onChange={onChange}
      onCursorChange={onCursorChange}
      onRunStatement={onRunStatement}
      onRunSelection={onRunSelection}
      onRunScript={onRunScript}
      onCancel={onCancel}
    />
  )
}
