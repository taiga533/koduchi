import { ResultContextMenu } from 'koduchi-ui'

const noop = () => {}

/** 右クリックした位置に 3 項目のメニューが出る。編集や貼り付けは無い。 */
export const Open = () => (
  // メニューは `fixed` で置かれる。transform を持つ器にして、位置をカードの中へ閉じ込める。
  <div
    style={{
      position: 'relative',
      width: 320,
      height: 160,
      background: 'var(--panel)',
      transform: 'translateZ(0)',
      overflow: 'hidden',
    }}
  >
    <ResultContextMenu
      x={48}
      y={24}
      onCopy={noop}
      onCopyWithHeader={noop}
      onCopyColumn={noop}
      onClose={noop}
    />
  </div>
)
