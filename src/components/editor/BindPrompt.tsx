import type { BindInput } from '../../stores/tab'
import { selectBindValues, useTabStore } from '../../stores/tab'
import { BindValuesDialog } from './BindValuesDialog'

interface BindPromptProps {
  /** 尋ねるバインド変数の名前。 */
  names: string[]
  /** 値が決まった。値そのものはタブストアに入っている。 */
  onSubmit: () => void
  /** 実行をやめる。 */
  onClose: () => void
}

/**
 * バインド変数ダイアログへ、選択中のタブが覚えている値を配る薄い包み。
 *
 * 入力のたびに描き直る範囲をここへ閉じ込める。アプリのルートで購読すると、
 * 1 文字打つたびにサイドバーと結果ペインまで組み直される。
 */
export function BindPrompt({ names, onSubmit, onClose }: BindPromptProps) {
  const tabId = useTabStore((state) => state.activeTabId)
  const values = useTabStore((state) => selectBindValues(state, tabId))
  const setBindValues = useTabStore((state) => state.setBindValues)

  /** 打った値はその場でタブに覚えさせる。次に尋ねるときの初期値になる。 */
  const onChange = (next: Record<string, BindInput>): void => {
    if (tabId) {
      setBindValues(tabId, next)
    }
  }

  return (
    <BindValuesDialog
      names={names}
      values={values}
      onChange={onChange}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
