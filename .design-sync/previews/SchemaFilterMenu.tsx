import { useEffect, useRef } from 'react'
import { SchemaFilterMenu, useSchemaStore } from 'koduchi-ui'

// シノニムと DB link を落とした接続。既定（全部オン）との違いが見えるようにする。
useSchemaStore.setState({
  filter: {
    excludeSystem: true,
    hideEmpty: false,
    kinds: {
      table: true,
      view: true,
      materializedView: true,
      index: true,
      trigger: true,
      sequence: true,
      synonym: false,
      type: true,
      function: true,
      procedure: true,
      package: true,
      databaseLink: false,
    },
  },
})

// 開閉は部品の内側の状態なので、描いた後にボタンを押して開く。
// 開いているときは押さないので、二度走っても閉じない。
const OpenedMenu = () => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const button = ref.current?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    button?.click()
  }, [])
  return (
    <div
      ref={ref}
      style={{
        width: 300,
        height: 330,
        display: 'flex',
        justifyContent: 'flex-end',
        padding: 12,
        background: 'var(--panel)',
      }}
    >
      <SchemaFilterMenu connectionId="preview-1" savedConnectionId="saved-hr" />
    </div>
  )
}

/** 閉じた状態。検索欄の右に並ぶアイコンだけ。 */
export const Closed = () => (
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
    <SchemaFilterMenu connectionId="preview-1" savedConnectionId="saved-hr" />
  </div>
)

/** 開いた状態。シノニムと DB link を外し、空のスキーマも出している。 */
export const Open = () => <OpenedMenu />
