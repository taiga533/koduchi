import { SqlEditor } from 'koduchi-ui'

const noop = () => {}

// カタログは補完にしか効かない。見本では候補を出さないので空で足りる。
const emptyCatalog = { schemas: new Map(), defaultSchema: null }

const handlers = {
  onChange: noop,
  onCursorChange: noop,
  onRunStatement: noop,
  onRunSelection: noop,
  onRunScript: noop,
  onCancel: noop,
  onFormatFailed: noop,
}

// エディタは `h-full` なので、高さを持つ器に入れる。
const frame = { width: 640, height: 300, background: 'var(--panel)' } as const

/** 結合と集約を含む問い合わせ。キーワード・文字列・数値の色分けが見える。 */
export const Query = () => (
  <div style={frame}>
    <SqlEditor
      value={`-- 部署ごとの平均給与（5000 以上）
SELECT d.department_name,
       COUNT(*)          AS headcount,
       ROUND(AVG(e.salary), 2) AS avg_salary
  FROM hr.employees e
  JOIN hr.departments d
    ON d.department_id = e.department_id
 WHERE e.hire_date >= DATE '2005-01-01'
   AND d.location_id = :location_id
 GROUP BY d.department_name
HAVING AVG(e.salary) >= 5000
 ORDER BY avg_salary DESC;`}
      catalog={emptyCatalog}
      identifierCase="preserve"
      {...handlers}
    />
  </div>
)

/** PL/SQL の無名ブロックと q 引用の文字列。 */
export const PlsqlBlock = () => (
  <div style={frame}>
    <SqlEditor
      value={`BEGIN
  UPDATE hr.employees
     SET salary = salary * 1.05
   WHERE department_id = 60;

  INSERT INTO hr.job_history (employee_id, start_date, end_date, job_id, department_id)
  VALUES (104, DATE '2019-05-21', SYSDATE, 'IT_PROG', 60);

  DBMS_OUTPUT.PUT_LINE(q'[昇給を反映しました（IT 部門）]');
END;
/`}
      catalog={emptyCatalog}
      identifierCase="upper"
      {...handlers}
    />
  </div>
)
