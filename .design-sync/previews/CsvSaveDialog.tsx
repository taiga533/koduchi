import { CsvSaveDialog } from 'koduchi-ui'
import type { CsvOptions } from 'koduchi-ui'

const noop = () => {}

const frame = { position: 'relative', width: 560, height: 420, background: 'var(--panel)' } as const

const excelDefaults: CsvOptions = { delimiter: 'comma', encoding: 'utf8Bom', nullText: 'blank' }
const handlers = { onChange: noop, onStart: noop, onCancel: noop, onClose: noop }

/** 書き出す前。書式を選んで保存先を決める。 */
export const BeforeStart = () => (
  <div style={frame}>
    <CsvSaveDialog options={excelDefaults} progress={null} {...handlers} />
  </div>
)

/** 書き出しの途中。中止できる。 */
export const Exporting = () => (
  <div style={frame}>
    <CsvSaveDialog
      options={{ delimiter: 'tab', encoding: 'shiftJis', nullText: 'word' }}
      progress={{ rows: 128400, done: false, error: null }}
      {...handlers}
    />
  </div>
)

/** 書き終えたが、切り詰められた CLOB が混ざっていた。 */
export const DoneWithTruncated = () => (
  <div style={frame}>
    <CsvSaveDialog
      options={excelDefaults}
      progress={{ rows: 350000, done: true, error: null, truncatedCells: 12 }}
      {...handlers}
    />
  </div>
)

/** 書き出しに失敗した。 */
export const Failed = () => (
  <div style={frame}>
    <CsvSaveDialog
      options={excelDefaults}
      progress={{ rows: 5200, done: false, error: 'ORA-01555: スナップショットが古すぎます' }}
      {...handlers}
    />
  </div>
)
