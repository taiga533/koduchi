/**
 * スキーマツリーを取り直すボタン（ADR 0007 の手動リロード）。
 *
 * DDL を流した直後のツリーは古い。絞り込みの条件を変えれば取り直されるが、
 * 条件を変えずに取り直す入口が絞り込みメニューの中にしか無く、辿り着けなかった。
 * 検索欄の隣、絞り込みの隣に置いて、1 度の押し下げで届くようにしてある。
 *
 * 取り直すのは全部である。段階 1 は 1 クエリで、段階 2 は背景で流し込まれる
 * （ADR 0007）。開いている枝だけを取り直す道は作っていない。
 *
 * 読み込み中は押せない。二度押しでもう 1 本の取得が走ると、後から返ったほうが
 * 勝つ順番を約束できない。
 */

import { RefreshCw } from 'lucide-react'
import { useSchemaStore } from '../../stores/schema'

interface SchemaReloadButtonProps {
  /** 接続の識別子。未接続なら操作できない。 */
  connectionId: string | null
  /** ツリーを取得し直す。 */
  onReload: (connectionId: string) => Promise<void>
}

export function SchemaReloadButton({ connectionId, onReload }: SchemaReloadButtonProps) {
  const loading = useSchemaStore((state) => state.status === 'loading')
  const disabled = connectionId === null || loading

  return (
    <button
      type="button"
      onClick={() => {
        if (connectionId) {
          void onReload(connectionId)
        }
      }}
      aria-label="スキーマを再読み込み"
      title="スキーマを再読み込み"
      disabled={disabled}
      className="w-26px h-26px flex items-center justify-center rounded-7px bg-fill border-none cursor-pointer font-inherit text-fg4 disabled:opacity-50"
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
    </button>
  )
}
