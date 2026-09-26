import { Splitter } from 'koduchi-ui'

const noop = () => {}

/** サイドバーと本体の間の縦線。幅を変える。 */
export const Vertical = () => (
  <div style={{ display: 'flex', width: 480, height: 220, background: 'var(--panel)' }}>
    <div
      style={{
        width: 200,
        background: 'var(--bg)',
        padding: 10,
        fontSize: 12,
        color: 'var(--fg4)',
      }}
    >
      サイドバー
    </div>
    <Splitter
      orientation="vertical"
      value={200}
      min={160}
      max={480}
      defaultValue={240}
      onChange={noop}
      label="サイドバーの幅"
    />
    <div style={{ flex: 1, padding: 10, fontSize: 12, color: 'var(--fg4)' }}>エディタ</div>
  </div>
)

/** エディタと結果ペインの間の横線。高さを変える。 */
export const Horizontal = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      width: 480,
      height: 260,
      background: 'var(--panel)',
    }}
  >
    <div style={{ height: 120, padding: 10, fontSize: 12, color: 'var(--fg4)' }}>エディタ</div>
    <Splitter
      orientation="horizontal"
      value={120}
      min={80}
      max={400}
      defaultValue={180}
      onChange={noop}
      label="結果ペインの高さ"
    />
    <div
      style={{ flex: 1, background: 'var(--bg)', padding: 10, fontSize: 12, color: 'var(--fg4)' }}
    >
      結果
    </div>
  </div>
)
