/**
 * エディタと補完のまとまり。
 *
 * 打鍵のたびに描き直る範囲をこの中へ閉じ込める。内容も補完の元もここで購読し、
 * アプリのルートへは伝えない。ルートが打鍵ごとに描き直ると、サイドバーの
 * スキーマツリーと結果テーブルまで一緒に組み直され、文字の表示とカーソルの
 * 移動が目に見えて遅れる。
 */

import { useCallback, useMemo } from 'react'
import { buildCompletionSchema, useSchemaStore } from '../../stores/schema'
import { selectActiveTab, useTabStore } from '../../stores/tab'
import type { TableColumn } from '../../types/db'
import { SqlEditor, type EditorPosition } from './SqlEditor'

/** 列がまだ読み込まれていないときに渡す表。参照を固定して再計算を避ける。 */
const NO_COLUMNS: Record<string, TableColumn[]> = {}

interface EditorPanelProps {
  /** カーソル位置や選択が変わったときに呼ばれる。 */
  onCursorChange: (position: EditorPosition) => void
  /** `⌘⏎`。カーソル位置の文を実行する。 */
  onRunStatement: () => void
  /** `⇧⌘⏎`。選択範囲を実行する。 */
  onRunSelection: () => void
  /** `⌘.`。実行を中止する。 */
  onCancel: () => void
}

/**
 * 選択中のタブを SQL エディタへ繋ぐ。
 *
 * @param props 実行と中止の呼び出し口
 */
export function EditorPanel({
  onCursorChange,
  onRunStatement,
  onRunSelection,
  onCancel,
}: EditorPanelProps) {
  const activeTab = useTabStore(selectActiveTab)
  const updateContent = useTabStore((state) => state.updateContent)

  const schemas = useSchemaStore((state) => state.schemas)
  const schemaColumns = useSchemaStore((state) => state.columns)
  const columnsReady = useSchemaStore((state) => state.columnStatus === 'ready')

  /**
   * 補完の元。
   *
   * 列は読み込み終えてから 1 度だけ渡す。段階 2 の途中で差し替え続けると、
   * 候補が出ている最中に言語設定が作り直されてちらつく（ADR 0007）。
   */
  const readyColumns = columnsReady ? schemaColumns : NO_COLUMNS
  const completionSchema = useMemo(
    () => buildCompletionSchema(schemas, readyColumns),
    [readyColumns, schemas],
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
      value={activeTab.content}
      schema={completionSchema}
      onChange={onChange}
      onCursorChange={onCursorChange}
      onRunStatement={onRunStatement}
      onRunSelection={onRunSelection}
      onCancel={onCancel}
    />
  )
}
