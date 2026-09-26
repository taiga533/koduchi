import { DisconnectBlockedDialog } from 'koduchi-ui'

const noop = () => {}

/** 実行中に切断しようとしたとき。ウィンドウ全体を暗幕で覆い、先に中止を促す。 */
export const RunningStatement = () => (
  <div style={{ position: 'relative', width: 560, height: 280, background: 'var(--panel)' }}>
    <DisconnectBlockedDialog onCancelExecution={noop} onClose={noop} />
  </div>
)
