import { BindValuesDialog } from 'koduchi-ui'

const noop = () => {}

// ダイアログは `absolute inset-0` で暗幕ごと器を覆うため、寸法を持つ器に入れる。
const frame = { position: 'relative', width: 560, height: 380, background: 'var(--panel)' } as const

/** 実行前に尋ねられたところ。前回の値が残っている。 */
export const Filled = () => (
  <div style={frame}>
    <BindValuesDialog
      names={['dept_id', 'min_salary']}
      values={{
        dept_id: { text: '60', kind: 'number', isNull: false },
        min_salary: { text: '5000', kind: 'number', isNull: false },
      }}
      onChange={noop}
      onSubmit={noop}
      onClose={noop}
    />
  </div>
)

/** 型の違う変数が並び、1 つを NULL にしたところ。 */
export const MixedKindsWithNull = () => (
  <div style={frame}>
    <BindValuesDialog
      names={['last_name', 'hired_from', 'manager_id']}
      values={{
        last_name: { text: 'King', kind: 'varchar2', isNull: false },
        hired_from: { text: '2005-01-01', kind: 'date', isNull: false },
        manager_id: { text: '', kind: 'number', isNull: true },
      }}
      onChange={noop}
      onSubmit={noop}
      onClose={noop}
    />
  </div>
)
