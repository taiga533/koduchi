import { StatusBar, useConnectionStore, useExecutionStore, useUiStore } from 'koduchi-ui'
import type { ActiveConnection } from 'koduchi-ui'

// StatusBar は props ではなくストアから接続の様子を読む。ストアはページに
// 1 つしか無いため、このカードの見本はどれも同じ接続を映す。
const connection: ActiveConnection = {
  id: 'preview-1',
  savedId: 'saved-hr',
  name: 'HR（開発）',
  params: {
    username: 'hr',
    password: '',
    target: {
      method: 'ezConnect',
      host: 'db.example.internal',
      port: 1521,
      serviceName: 'FREEPDB1',
    },
    readOnly: false,
    autoCommit: false,
  },
  completion: { identifierCase: 'preserve' },
  color: 'green',
  group: null,
}

useConnectionStore.setState({ status: 'connected', connection, error: null })
useUiStore.setState({ cursor: { line: 12, column: 8 } })
useExecutionStore.setState({ inTransaction: true })

const noop = () => {}

/** 手動コミットの接続に未コミットの変更があるとき。コミット / ロールバックが出る。 */
export const ConnectedWithPendingChanges = () => (
  <div style={{ width: '100%' }}>
    <StatusBar
      onOpenSettings={noop}
      onDisconnect={noop}
      onSwitchConnection={noop}
      onOpenSessions={noop}
      onOpenSourceSearch={noop}
      onCommit={noop}
      onRollback={noop}
      onReconnect={noop}
    />
  </div>
)
