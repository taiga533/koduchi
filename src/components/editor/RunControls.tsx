/**
 * 実行ボタンの状態を配る薄い包み。
 *
 * 実行中かどうかと選択の有無はストアから読む。ここで購読しておくことで、
 * 打鍵のたびにアプリ全体を描き直さずに済む。
 */

import { useExecutionStore } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { RunButton } from './RunButton'

interface RunControlsProps {
  /** 選択中のタブ。実行中かどうかはこのタブについて見る。 */
  tabId: string | null
  onRun: () => void
  onRunSelection: () => void
  onRunScript: () => void
  onExplain: () => void
  onExplainActual: () => void
  onSaveCsv: () => void
  onCancel: () => void
}

export function RunControls({ tabId, ...handlers }: RunControlsProps) {
  const running = useExecutionStore((state) =>
    tabId === null ? false : state.byTab[tabId]?.status === 'running',
  )
  const hasSelection = useUiStore((state) => state.hasSelection)

  return <RunButton running={running} hasSelection={hasSelection} {...handlers} />
}
