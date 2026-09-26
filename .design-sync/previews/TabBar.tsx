import { TabBar, useTabStore } from 'koduchi-ui'
import type { EditorTab } from 'koduchi-ui'

// TabBar はストアからタブの並びを読む。見本はどれも同じ並びを映す。
const tabs: EditorTab[] = [
  {
    kind: 'sql',
    id: 'tab-1',
    name: 'salary_report.sql',
    customName: '部署別の平均給与',
    filePath: '/Users/hr/queries/salary_report.sql',
    content: 'SELECT ...',
    dirty: false,
  },
  {
    kind: 'sql',
    id: 'tab-2',
    name: '無題-2.sql',
    customName: null,
    filePath: null,
    content: 'SELECT * FROM hr.employees',
    dirty: true,
  },
  {
    kind: 'definition',
    id: 'tab-3',
    name: 'EMPLOYEES',
    target: { owner: 'HR', name: 'EMPLOYEES', kind: 'table' },
  },
  {
    kind: 'sql',
    id: 'tab-4',
    name: 'job_history_cleanup.sql',
    customName: null,
    filePath: '/Users/hr/queries/job_history_cleanup.sql',
    content: 'DELETE FROM hr.job_history WHERE ...',
    dirty: false,
  },
]

useTabStore.setState({ tabs, activeTabId: 'tab-2' })

const noop = () => {}

/** SQL タブと定義タブが混ざった並び。選んでいる「無題-2.sql」は未保存の ● 付き。 */
export const MixedTabs = () => (
  <div style={{ width: '100%', background: 'var(--panel)' }}>
    <TabBar onCloseTab={noop} />
  </div>
)
