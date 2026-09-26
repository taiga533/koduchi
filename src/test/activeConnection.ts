/**
 * テスト用の接続済みの状態（ADR 0010）。
 *
 * 接続の手順を通さずに「繋がっている」状態から始めるために使う。仲介者の
 * 単体テスト（ADR 0035）は、どれもこの状態を前提に裁定を呼ぶ。
 */

import type { ActiveConnection } from '../stores/connection'
import { useConnectionStore } from '../stores/connection'
import type { SqlTab } from '../stores/tab'
import { useTabStore } from '../stores/tab'

/** 接続済みの接続。識別子は `c1`、名前は `dev`。 */
export const 接続: ActiveConnection = {
  id: 'c1',
  savedId: null,
  name: 'dev',
  params: {
    username: 'koduchi',
    password: '',
    target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
    readOnly: false,
    autoCommit: false,
  },
  completion: { identifierCase: 'preserve' },
  color: 'none',
  group: null,
}

/**
 * 接続済みにする。
 *
 * @param overrides 接続の設定のうち変えたいもの（自動コミットなど）
 */
export function 接続済みにする(overrides: Partial<ActiveConnection['params']> = {}): void {
  useConnectionStore.setState({
    status: 'connected',
    connection: { ...接続, params: { ...接続.params, ...overrides } },
    error: null,
  })
}

/** 未接続にする。 */
export function 未接続にする(): void {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
}

/**
 * SQL タブ 1 枚だけを選んだ状態にする。
 *
 * @param tab タブの中身のうち変えたいもの
 */
export function SQLタブを一枚にする(tab: Partial<SqlTab> = {}): SqlTab {
  const sqlTab: SqlTab = {
    kind: 'sql',
    id: 'sql-1',
    name: '無題-1.sql',
    customName: null,
    filePath: null,
    content: '',
    dirty: false,
    ...tab,
  }
  useTabStore.setState({ tabs: [sqlTab], activeTabId: sqlTab.id, bindValues: {} })
  return sqlTab
}
