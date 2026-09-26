import { SourceSearchPanel, useSchemaStore, useSourceSearchStore } from 'koduchi-ui'
import type { SourceObjectMatches } from 'koduchi-ui'

// パネルは props ではなくストアから検索の状態を読む。ストアはページに 1 つなので、
// 見本は「探し終えて 1 行の前後を覗いている」いちばん情報の多い状態 1 つにする。

const objects: SourceObjectMatches[] = [
  {
    owner: 'HR',
    name: 'PKG_PAYROLL',
    kind: 'packageBody',
    lines: [
      { line: 42, text: '    UPDATE employees SET salary = salary * (1 + p_rate)' },
      {
        line: 118,
        text: '    SELECT salary INTO v_salary FROM employees WHERE employee_id = p_id;',
      },
    ],
  },
  {
    owner: 'HR',
    name: 'PKG_PAYROLL',
    kind: 'package',
    lines: [{ line: 7, text: '  PROCEDURE raise_salary(p_id IN NUMBER, p_rate IN NUMBER);' }],
  },
  {
    owner: 'HR',
    name: 'TRG_SALARY_AUDIT',
    kind: 'trigger',
    lines: [
      { line: 3, text: 'AFTER UPDATE OF salary ON employees' },
      { line: 9, text: '  VALUES (:old.employee_id, :old.salary, :new.salary, SYSDATE);' },
    ],
  },
  {
    owner: 'PAYROLL',
    name: 'CALC_BONUS',
    kind: 'function',
    lines: [{ line: 15, text: '  RETURN ROUND(p_salary * v_bonus_rate, 0);' }],
  },
]

useSchemaStore.setState({
  schemas: [
    { name: 'HR', objectCount: 34, objects: [] },
    { name: 'PAYROLL', objectCount: 12, objects: [] },
  ],
})

useSourceSearchStore.setState({
  needle: 'salary',
  owner: null,
  caseSensitive: false,
  result: { objects, matchedLines: 6, truncated: false },
  status: 'ready',
  error: null,
  permissionDenied: false,
  selected: { owner: 'HR', name: 'PKG_PAYROLL', kind: 'packageBody', line: 42 },
  context: [
    { line: 37, text: '  PROCEDURE raise_salary(p_id IN NUMBER, p_rate IN NUMBER) IS' },
    { line: 38, text: '  BEGIN' },
    { line: 39, text: '    IF p_rate > 0.2 THEN' },
    { line: 40, text: "      RAISE_APPLICATION_ERROR(-20001, '昇給率が上限を超えています');" },
    { line: 41, text: '    END IF;' },
    { line: 42, text: '    UPDATE employees SET salary = salary * (1 + p_rate)' },
    { line: 43, text: '     WHERE employee_id = p_id;' },
    { line: 44, text: '    log_change(p_id);' },
    { line: 45, text: '  END raise_salary;' },
  ],
  contextStatus: 'ready',
  contextError: null,
})

const noop = () => {}

/** 探し終えて、当たった行の前後を覗いているところ。当たりはオブジェクト単位に束ね、本体は種別の印で見分ける。 */
export const ResultsWithContext = () => (
  // パネルは `absolute inset-0` の暗幕ごと出る。寸法を持つ器に閉じ込める。
  <div style={{ position: 'relative', width: 860, height: 560, background: 'var(--bg)' }}>
    <SourceSearchPanel connectionId="preview-1" onClose={noop} />
  </div>
)
