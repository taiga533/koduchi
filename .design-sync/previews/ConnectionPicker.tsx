import { defaultSchemaFilter, ConnectionPicker, createDesignDbApi, setDbApi } from 'koduchi-ui'
import type { SavedConnection } from 'koduchi-ui'

const schemaFilter = defaultSchemaFilter

const common = {
  schemaFilter,
  completion: { identifierCase: 'preserve' as const },
  autoCommit: false,
}

const saved: SavedConnection[] = [
  {
    ...common,
    id: 'c1',
    name: 'HR（手元）',
    username: 'hr',
    readOnly: false,
    color: 'none',
    group: null,
    target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
  },
  {
    ...common,
    id: 'c2',
    name: '開発',
    username: 'hr',
    readOnly: false,
    color: 'green',
    group: '開発・検証',
    target: {
      method: 'ezConnect',
      host: 'db-dev.example.internal',
      port: 1521,
      serviceName: 'HRDEV',
    },
  },
  {
    ...common,
    id: 'c3',
    name: '検証',
    username: 'hr_app',
    readOnly: false,
    color: 'blue',
    group: '開発・検証',
    target: {
      method: 'ezConnect',
      host: 'db-stg.example.internal',
      port: 1521,
      serviceName: 'HRSTG',
    },
  },
  {
    ...common,
    id: 'c4',
    name: '本番東京',
    username: 'hr_read',
    readOnly: true,
    color: 'red',
    group: '本番',
    target: { method: 'tns', directory: '/opt/oracle/network/admin', alias: 'HRPRD_TYO' },
  },
  {
    ...common,
    id: 'c5',
    name: '本番大阪',
    username: 'hr_read',
    readOnly: true,
    color: 'orange',
    group: '本番',
    target: { method: 'tns', directory: '/opt/oracle/network/admin', alias: 'HRPRD_OSA' },
  },
]

// 一覧は描いた直後に窓口から読む。描画環境の窓口は決着しないため、
// `listSavedConnections` だけ答えを返す代役へ差し替える。
setDbApi(
  createDesignDbApi({
    listSavedConnections: async () => saved,
  }),
)

const noop = () => {}

/** 保存済みの接続がグループごとに並ぶ。左端の帯が色、鍵が読み取り専用。 */
export const Grouped = () => (
  <div style={{ width: 600, padding: 40, background: 'var(--panel)' }}>
    <ConnectionPicker onCreate={noop} onEdit={noop} />
  </div>
)
