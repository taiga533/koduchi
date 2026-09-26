/**
 * CSV 保存ダイアログへ、書式の設定と書き出しの進み具合を配る包み（`⌥⌘S`）。
 *
 * 進み具合と中止の印は、ダイアログを開いている間だけ意味を持つ。寿命が
 * この部品と同じであるため、アプリのルートではなくここに閉じ込める
 * （ADR 0035）。書き出しそのものの裁定は仲介者の `exportActiveResult` にある。
 */

import { useRef, useState } from 'react'
import { exportActiveResult } from '../../mediator/csv'
import { useUiStore } from '../../stores/ui'
import type { CsvExportState } from './CsvSaveDialog'
import { CsvSaveDialog } from './CsvSaveDialog'

interface CsvExportDialogProps {
  /** ダイアログを閉じる。書き出しの途中なら中止してから閉じる。 */
  onClose: () => void
}

export function CsvExportDialog({ onClose }: CsvExportDialogProps) {
  const options = useUiStore((state) => state.csvOptions)
  const setCsvOptions = useUiStore((state) => state.setCsvOptions)
  const [progress, setProgress] = useState<CsvExportState | null>(null)
  // 書き出しのかたまりごとに読む値であり、描画には関わらないため ref で持つ。
  const cancelled = useRef(false)

  /** 書き出しを始める。前回の中止の印を持ち越さない。 */
  const start = (): void => {
    cancelled.current = false
    void exportActiveResult({
      report: setProgress,
      isCancelled: () => cancelled.current,
    })
  }

  return (
    <CsvSaveDialog
      options={options}
      onChange={setCsvOptions}
      progress={progress}
      onStart={start}
      onCancel={() => {
        cancelled.current = true
      }}
      onClose={() => {
        cancelled.current = true
        onClose()
      }}
    />
  )
}
