import { defaultSchemaFilter, ConnectionForm, createDesignDbApi, setDbApi } from 'koduchi-ui'
import type { SavedConnection, TnsnamesFile } from 'koduchi-ui'

const schemaFilter = defaultSchemaFilter

const devConnection: SavedConnection = {
  id: 'c2',
  name: '開発',
  username: 'hr',
  readOnly: false,
  autoCommit: false,
  color: 'green',
  group: '開発・検証',
  schemaFilter,
  completion: { identifierCase: 'lower' },
  target: {
    method: 'ezConnect',
    host: 'db-dev.example.internal',
    port: 1521,
    serviceName: 'HRDEV',
  },
}

const prodConnection: SavedConnection = {
  ...devConnection,
  id: 'c4',
  name: '本番東京',
  username: 'hr_read',
  readOnly: true,
  color: 'red',
  group: '本番',
  completion: { identifierCase: 'preserve' },
  target: { method: 'tns', directory: '/opt/oracle/network/admin', alias: 'HRPRD_TYO' },
}

const tnsnames: TnsnamesFile = {
  entries: [
    {
      aliases: ['HRPRD_TYO', 'HRPRD'],
      descriptor:
        '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db-tyo.example.internal)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=HRPRD)))',
    },
    {
      aliases: ['HRPRD_OSA'],
      descriptor:
        '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db-osa.example.internal)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=HRPRD)))',
    },
  ],
  warnings: ['12 行目: IFILE=/opt/oracle/network/admin/common.ora は読み込みません'],
}

// 編集で開くとパスワードと tnsnames.ora を窓口から読む。描画環境の窓口は
// 決着しないため、読み取りの 3 つだけ答えを返す代役へ差し替える。
setDbApi(
  createDesignDbApi({
    listSavedConnections: async () => [devConnection, prodConnection],
    loadConnectionPassword: async () => 'hr-password',
    readTnsnames: async () => tnsnames,
  }),
)

const noop = () => {}

const frame: React.CSSProperties = { width: 600, padding: 40, background: 'var(--panel)' }

/** 新しい接続。EZConnect の欄が空で、「保存して接続」はまだ押せない。 */
export const New = () => (
  <div style={frame}>
    <ConnectionForm onBack={noop} />
  </div>
)

/** 保存済みの EZConnect 接続を編集する。欄と色・グループ・補完の綴りが埋まる。 */
export const EditEzConnect = () => (
  <div style={frame}>
    <ConnectionForm initial={devConnection} onBack={noop} />
  </div>
)

/** TNS の接続を編集する。エイリアスは tnsnames.ora から選び、読み飛ばした箇所を添える。 */
export const EditTnsReadOnly = () => (
  <div style={frame}>
    <ConnectionForm initial={prodConnection} onBack={noop} />
  </div>
)
