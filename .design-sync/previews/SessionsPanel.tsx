import { SessionsPanel, useSessionsStore } from 'koduchi-ui'
import type { SessionOverview, SessionRow } from 'koduchi-ui'

// 開いた時点の `load()` は決着しないが、一覧が既にあれば段階を書き換えない。
// 読み終えた状態を先に置いておけば、そのまま一覧が出る。
const base: Omit<
  SessionRow,
  | 'sid'
  | 'serial'
  | 'username'
  | 'status'
  | 'program'
  | 'event'
  | 'secondsInWait'
  | 'blockingSession'
  | 'own'
> = {
  osuser: null,
  machine: null,
  process: null,
  module: null,
  sqlId: null,
  logonTime: '2026-09-27 09:02:11',
  blockingInstance: null,
}

const sessions: SessionRow[] = [
  {
    ...base,
    sid: 132,
    serial: 40211,
    username: 'HR',
    status: 'ACTIVE',
    osuser: 'taiga',
    machine: 'mbp-taiga.local',
    program: 'koduchi',
    event: 'SQL*Net message from client',
    secondsInWait: 0,
    blockingSession: null,
    own: true,
  },
  {
    ...base,
    sid: 145,
    serial: 8813,
    username: 'HR',
    status: 'INACTIVE',
    osuser: 'taiga',
    machine: 'mbp-taiga.local',
    program: 'koduchi',
    event: 'SQL*Net message from client',
    secondsInWait: 212,
    blockingSession: null,
    own: true,
  },
  {
    ...base,
    sid: 211,
    serial: 5521,
    username: 'PAYROLL_BATCH',
    status: 'INACTIVE',
    osuser: 'batch',
    machine: 'batch01.example.internal',
    program: 'JDBC Thin Client',
    event: 'SQL*Net message from client',
    secondsInWait: 1840,
    blockingSession: null,
    own: false,
  },
  {
    ...base,
    sid: 318,
    serial: 1207,
    username: 'HR_APP',
    status: 'ACTIVE',
    osuser: 'tomcat',
    machine: 'ap02.example.internal',
    program: 'JDBC Thin Client',
    event: 'enq: TX - row lock contention',
    secondsInWait: 96,
    blockingSession: 211,
    own: false,
  },
  {
    ...base,
    sid: 402,
    serial: 33,
    username: 'HR_APP',
    status: 'ACTIVE',
    osuser: 'tomcat',
    machine: 'ap01.example.internal',
    program: 'JDBC Thin Client',
    event: 'enq: TX - row lock contention',
    secondsInWait: 41,
    blockingSession: 318,
    own: false,
  },
  {
    ...base,
    sid: 77,
    serial: 9001,
    username: 'SUZUKI',
    status: 'INACTIVE',
    osuser: 'suzuki',
    machine: 'win-suzuki',
    program: 'sqldeveloper64W.exe',
    event: 'SQL*Net message from client',
    secondsInWait: 5,
    blockingSession: null,
    own: false,
  },
]

const overview: SessionOverview = {
  instance: 1,
  currentSid: 132,
  sessions,
  chains: [{ sid: 211, blocked: [{ sid: 318, blocked: [{ sid: 402, blocked: [] }] }] }],
}

useSessionsStore.setState({
  overview,
  status: 'ready',
  error: null,
  permissionDenied: false,
  search: '',
  autoRefresh: true,
  killTarget: null,
  killError: null,
})

const noop = () => {}

const frame: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 520,
  background: 'var(--panel)',
  transform: 'translateZ(0)',
}

/** 行ロックの連鎖があるとき。根から字下げして並び、待っている行にブロック元が出る。 */
export const BlockingChain = () => (
  <div style={frame}>
    <SessionsPanel connectionId="preview-hr" readOnly={false} onClose={noop} />
  </div>
)

/** 読み取り専用の接続。kill のボタンを出さない。 */
export const ReadOnly = () => (
  <div style={frame}>
    <SessionsPanel connectionId="preview-hr" readOnly onClose={noop} />
  </div>
)
