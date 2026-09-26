import { InstantClientNotice } from 'koduchi-ui'

// ODPI-C が Instant Client を読めなかったときの実際の文面に寄せる。
const dpiMessage =
  'DPI-1047: Cannot locate a 64-bit Oracle Client library: "dlopen(libclntsh.dylib, 0x0001): tried: \'libclntsh.dylib\' (no such file)". See https://oracle.github.io/odpi/doc/installation.html#macos for help'

/** 候補が見つかったとき。先頭の候補が入力欄に入り、保存を押すだけで済む。 */
export const WithCandidates = () => (
  <div style={{ width: 640, padding: 40, background: 'var(--panel)' }}>
    <InstantClientNotice
      message={dpiMessage}
      candidates={['/opt/homebrew/lib', '/Users/hr/Downloads/instantclient_23_3']}
    />
  </div>
)

/** 候補が 1 つも無いとき。入力欄は空で、保存は押せない。 */
export const NoCandidates = () => (
  <div style={{ width: 640, padding: 40, background: 'var(--panel)' }}>
    <InstantClientNotice message={dpiMessage} candidates={[]} />
  </div>
)
