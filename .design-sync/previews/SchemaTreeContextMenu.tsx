import type { ReactNode } from 'react'
import { SchemaTreeContextMenu } from 'koduchi-ui'

const noop = () => {}

const handlers = {
  onCopy: noop,
  onInsert: noop,
  onOpenSelect: noop,
  onOpenDefinition: noop,
  onClose: noop,
}

// メニューは `fixed` で置かれる。transform を持つ器は fixed の基準になるため、
// 見本の枠の中に閉じ込められる。
const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      position: 'relative',
      width: 260,
      height: 170,
      transform: 'translateZ(0)',
      background: 'var(--panel)',
    }}
  >
    {children}
  </div>
)

/** テーブルの行。4 項目すべて（コピー・挿入・SELECT・定義）が並ぶ。 */
export const TableRow = () => (
  <Frame>
    <SchemaTreeContextMenu
      x={24}
      y={16}
      target="HR.EMPLOYEES"
      canSelect
      canOpenDefinition
      {...handlers}
    />
  </Frame>
)

/** 索引の行。列を持たないので `SELECT を開く` は出ない。 */
export const IndexRow = () => (
  <Frame>
    <SchemaTreeContextMenu
      x={24}
      y={16}
      target="HR.EMP_EMAIL_UK"
      canSelect={false}
      canOpenDefinition
      {...handlers}
    />
  </Frame>
)

/** 列の行。修飾しない名前で、コピーと挿入だけ。 */
export const ColumnRow = () => (
  <Frame>
    <SchemaTreeContextMenu
      x={24}
      y={16}
      target="SALARY"
      canSelect={false}
      canOpenDefinition={false}
      {...handlers}
    />
  </Frame>
)
