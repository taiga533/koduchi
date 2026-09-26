import { CellDetailPanel } from 'koduchi-ui'
import type { Column } from 'koduchi-ui'

const noop = () => {}

const noteColumn: Column = { name: 'JOB_DESCRIPTION', typeName: 'VARCHAR2(4000)', kind: 'text' }
const jsonColumn: Column = { name: 'PROFILE_JSON', typeName: 'CLOB', kind: 'text' }
const clobColumn: Column = { name: 'REVIEW_NOTE', typeName: 'CLOB', kind: 'text' }
const blobColumn: Column = { name: 'PHOTO', typeName: 'BLOB', kind: 'binary' }

const profile = JSON.stringify({
  employeeId: 145,
  lastName: 'Russell',
  department: '営業部',
  skills: ['法人営業', '英語'],
  manager: { employeeId: 100, lastName: 'King' },
})

const longReview =
  '2026 年度上期の評価。担当顧客の更新率は前年比 +4.2pt で、部内で最も高い。\n' +
  '一方で新規開拓の件数が目標に届かず、下期は関西圏の代理店経由の案件を増やす方針とした。\n' +
  '面談の記録（抜粋）: 本人は海外案件への異動を希望している。語学研修の受講を勧めた。\n'.repeat(6)

const frame = { width: 320, height: 360, display: 'flex', background: 'var(--panel)' } as const

/** 文字列の値。全文を折り返して出す。 */
export const TextValue = () => (
  <div style={frame}>
    <CellDetailPanel
      column={noteColumn}
      cell={{
        text: '法人顧客の新規開拓と既存顧客の契約更新を担当する。四半期ごとに売上見込みを経営企画部へ報告する。',
        kind: 'text',
      }}
      rowNumber={5}
      onClose={noop}
    />
  </div>
)

/** JSON として読める値。「JSON として整形する」が出て、字下げして表示する。 */
export const JsonValue = () => (
  <div style={frame}>
    <CellDetailPanel
      column={jsonColumn}
      cell={{ text: profile, kind: 'text' }}
      rowNumber={5}
      onClose={noop}
    />
  </div>
)

/** 64KB を超えて切り詰められた CLOB。本文の上に注意書きが出る。 */
export const TruncatedClob = () => (
  <div style={frame}>
    <CellDetailPanel
      column={clobColumn}
      cell={{ text: longReview, kind: 'text', truncated: true }}
      rowNumber={12}
      onClose={noop}
    />
  </div>
)

/** BLOB は中身を持たないため、大きさだけを示す。 */
export const BinaryValue = () => (
  <div style={frame}>
    <CellDetailPanel
      column={blobColumn}
      cell={{ text: '[BLOB 48.2 KB]', kind: 'binary' }}
      rowNumber={3}
      onClose={noop}
    />
  </div>
)
