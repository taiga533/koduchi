import { SchemaReloadButton, useSchemaStore } from 'koduchi-ui'

// 読み込み中かどうかはストアの段階で決まる。見本はどれも読み込み済みで描く。
useSchemaStore.setState({ status: 'ready' })

const reload = async () => {}

/** 繋がっていて読み込み済み。押すとツリーを丸ごと取り直す。 */
export const Ready = () => (
  <div
    style={{
      width: 120,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--panel)',
    }}
  >
    <SchemaReloadButton connectionId="preview-1" onReload={reload} />
  </div>
)

/** 未接続。押せない。 */
export const Disconnected = () => (
  <div
    style={{
      width: 120,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--panel)',
    }}
  >
    <SchemaReloadButton connectionId={null} onReload={reload} />
  </div>
)
