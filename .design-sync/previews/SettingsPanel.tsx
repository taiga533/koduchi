import { SettingsPanel, useUiStore } from 'koduchi-ui'

// 設定値はストアから読む。既定と違う値を置き、選択中の区別が見えるようにする。
useUiStore.setState((state) => ({
  appearance: {
    ...state.appearance,
    theme: 'system',
    editorFontSize: 'large',
    rowHeight: 'comfortable',
    gridLines: true,
  },
}))

const noop = () => {}

/** Instant Client を検出済みのとき。項目は外観と履歴だけ。 */
export const Default = () => (
  <div
    style={{
      position: 'relative',
      width: 560,
      height: 460,
      background: 'var(--panel)',
      transform: 'translateZ(0)',
    }}
  >
    <SettingsPanel clientUnavailable={false} onClose={noop} />
  </div>
)

/** Instant Client が未検出のとき。ライブラリのディレクトリの欄が加わる。 */
export const ClientUnavailable = () => (
  <div
    style={{
      position: 'relative',
      width: 560,
      height: 540,
      background: 'var(--panel)',
      transform: 'translateZ(0)',
    }}
  >
    <SettingsPanel clientUnavailable onClose={noop} />
  </div>
)
