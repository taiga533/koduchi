import { TitleBar, useConnectionStore } from 'koduchi-ui'
import type { ActiveConnection } from 'koduchi-ui'

// TitleBar はストアから接続を読む。見本はどれも同じ接続を映す。
const connection: ActiveConnection = {
  id: 'preview-1',
  savedId: 'saved-hr-prod',
  name: 'HR（本番）',
  params: {
    username: 'hr_reader',
    password: '',
    target: { method: 'ezConnect', host: 'db.example.internal', port: 1521, serviceName: 'HRPDB' },
    readOnly: true,
    autoCommit: false,
  },
  completion: { identifierCase: 'preserve' },
  color: 'red',
  group: '人事システム',
}

useConnectionStore.setState({ status: 'connected', connection, error: null })

const noop = () => {}

/** 本番接続。上端の色帯とチップで接続の色を示し、中央にパレットの入口が出る。 */
export const Connected = () => (
  <div style={{ width: '100%', background: 'var(--panel)' }}>
    <TitleBar onOpenPalette={noop} />
  </div>
)
