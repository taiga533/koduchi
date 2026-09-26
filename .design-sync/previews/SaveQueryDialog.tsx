import { SaveQueryDialog } from 'koduchi-ui'

const noop = () => {}

const frame = { position: 'relative', width: 560, height: 360, background: 'var(--panel)' } as const

/** タブの名前を既定にして、保存する SQL の先頭を見せる。 */
export const ShortQuery = () => (
  <div style={frame}>
    <SaveQueryDialog
      defaultName="部署別の平均給与"
      sql={`SELECT d.department_name, AVG(e.salary) AS avg_salary
  FROM hr.employees e
  JOIN hr.departments d ON d.department_id = e.department_id
 GROUP BY d.department_name`}
      onSubmit={noop}
      onClose={noop}
    />
  </div>
)

/** 長い SQL は先頭だけが見える。 */
export const LongQuery = () => (
  <div style={frame}>
    <SaveQueryDialog
      defaultName="無題-3"
      sql={`WITH ranked AS (
  SELECT e.employee_id, e.last_name, e.salary, d.department_name,
         RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS rnk
    FROM hr.employees e
    JOIN hr.departments d ON d.department_id = e.department_id
)
SELECT *
  FROM ranked
 WHERE rnk <= 3
 ORDER BY department_name, rnk`}
      onSubmit={noop}
      onClose={noop}
    />
  </div>
)
