import { RunButton } from 'koduchi-ui'

const noop = () => {}

const handlers = {
  onRun: noop,
  onRunSelection: noop,
  onRunScript: noop,
  onExplain: noop,
  onExplainActual: noop,
  onSaveCsv: noop,
  onCancel: noop,
}

/** 待機中。エディタの右下に浮く。「実行」と `▾` の 2 つ割り。 */
export const Idle = () => (
  <div style={{ position: 'relative', width: 280, height: 72, background: 'var(--panel)' }}>
    <RunButton running={false} hasSelection={false} {...handlers} />
  </div>
)

/** 実行中は「中止」1 つに入れ替わる。 */
export const Running = () => (
  <div style={{ position: 'relative', width: 280, height: 72, background: 'var(--panel)' }}>
    <RunButton running hasSelection={false} {...handlers} />
  </div>
)
