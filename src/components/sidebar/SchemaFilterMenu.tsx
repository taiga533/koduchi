/**
 * スキーマの絞り込み条件（ADR 0007・0014）。
 *
 * 検索入力の横のアイコンから開く。スキーマを隠す条件が 2 つと、ツリーに載せる
 * オブジェクト種別の可否が 12 個ある。どれも既定で有効である。変更すると
 * 取得し直す。設定は接続ごとに保存される（ADR 0004）。
 *
 * 条件を変えずに取り直す入口はここではなく、隣の `SchemaReloadButton` である。
 * このメニューの持ち物は条件だけにしてある。
 */

import { useState } from 'react'
import { ListFilter } from 'lucide-react'
import { getDbApi } from '../../api/db'
import { useSchemaStore } from '../../stores/schema'
import type { ObjectKind, SchemaFilter } from '../../types/db'
import { OBJECT_KIND_LABELS, OBJECT_KIND_ORDER } from '../../types/db'

interface SchemaFilterMenuProps {
  /** 接続の識別子。未接続なら操作できない。 */
  connectionId: string | null
  /**
   * `connections.toml` に保存されている接続の ID。保存していなければ `null`。
   *
   * 設定はこの接続のエントリへ書き戻す（ADR 0004・0007）。
   */
  savedConnectionId: string | null
}

/**
 * フィルタ設定を接続のエントリへ書き戻す。
 *
 * 保存していない接続では何もしない。書き込みに失敗しても、その場の表示は
 * 既に切り替わっているため握りつぶす。
 *
 * @param savedConnectionId 保存済みの接続の ID
 * @param filter 保存する条件
 */
async function persist(savedConnectionId: string | null, filter: SchemaFilter): Promise<void> {
  if (!savedConnectionId) {
    return
  }

  try {
    const api = getDbApi()
    const saved = await api.listSavedConnections()
    const target = saved.find((connection) => connection.id === savedConnectionId)
    if (!target) {
      return
    }
    await api.saveConnection({ ...target, schemaFilter: filter }, null)
  } catch {
    // 設定の保存に失敗しても、絞り込みそのものは効いている。
  }
}

export function SchemaFilterMenu({ connectionId, savedConnectionId }: SchemaFilterMenuProps) {
  const [open, setOpen] = useState(false)
  const filter = useSchemaStore((state) => state.filter)
  const setFilter = useSchemaStore((state) => state.setFilter)

  const change = (patch: Partial<SchemaFilter>) => {
    if (!connectionId) {
      return
    }
    const next = { ...filter, ...patch }
    void setFilter(connectionId, next)
    void persist(savedConnectionId, next)
  }

  /**
   * 種別 1 つの表示可否を切り替える。
   *
   * @param kind 切り替える種別
   * @param shown 表示するか
   */
  const changeKind = (kind: ObjectKind, shown: boolean) => {
    change({ kinds: { ...filter.kinds, [kind]: shown } })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="スキーマの絞り込み"
        aria-expanded={open}
        disabled={connectionId === null}
        className="w-26px h-26px flex items-center justify-center rounded-7px bg-fill border-none cursor-pointer font-inherit text-fg4 disabled:opacity-50"
      >
        <ListFilter size={14} />
      </button>

      {open ? (
        <div className="absolute right-0 top-28px z-10 w-256px p-10px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-9px">
          <label className="flex items-start gap-8px text-11.5px text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={filter.excludeSystem}
              onChange={(event) => change({ excludeSystem: event.target.checked })}
            />
            <span className="leading-[1.5]">システムスキーマを除外</span>
          </label>
          <label className="flex items-start gap-8px text-11.5px text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={filter.hideEmpty}
              onChange={(event) => change({ hideEmpty: event.target.checked })}
            />
            <span className="leading-[1.5]">参照可能なオブジェクトが無いスキーマを隠す</span>
          </label>
          <p className="m-0 mt-2px pt-8px border-t border-line2 border-l-none border-r-none border-b-none text-10.5px text-fg4">
            ツリーに出す種別
          </p>
          <div className="grid grid-cols-2 gap-x-8px gap-y-6px">
            {OBJECT_KIND_ORDER.map((kind) => (
              <label
                key={kind}
                className="flex items-center gap-6px text-11px text-fg cursor-pointer min-w-0"
              >
                <input
                  type="checkbox"
                  checked={filter.kinds[kind]}
                  onChange={(event) => changeKind(kind, event.target.checked)}
                />
                <span className="truncate">{OBJECT_KIND_LABELS[kind]}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
