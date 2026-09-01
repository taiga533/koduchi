/**
 * ステータスバー（デザイン 3a の最下段）。
 *
 * カーソル位置・文字コード・データベースの種別・接続状態・読み取り専用の別と、
 * 設定への入口を並べる。
 *
 * カーソル位置は `ui` ストアから読む。打鍵のたびにアプリ全体を描き直さず、
 * ここだけが更新されるようにするためである。
 */

import { Lock, Settings } from 'lucide-react'
import { useConnectionStore } from '../../stores/connection'
import { useUiStore } from '../../stores/ui'

interface StatusBarProps {
  /** 設定画面を開く。 */
  onOpenSettings: () => void
}

/** 接続の段階を利用者向けの文言にする。 */
const STATUS_LABELS = {
  disconnected: '未接続',
  connecting: '接続中…',
  connected: '接続中',
  failed: '接続失敗',
} as const

export function StatusBar({ onOpenSettings }: StatusBarProps) {
  const status = useConnectionStore((state) => state.status)
  const connection = useConnectionStore((state) => state.connection)
  const cursor = useUiStore((state) => state.cursor)

  return (
    <footer className="h-26px flex items-center gap-16px px-14px bg-bg text-11px text-fg3 shrink-0">
      <span>
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <span>UTF-8</span>
      {connection ? <span>Oracle</span> : null}
      <span className="flex-1" />
      <span style={{ color: status === 'connected' ? 'oklch(0.58 0.12 152)' : undefined }}>
        {STATUS_LABELS[status]}
      </span>
      {connection?.params.readOnly ? (
        <span className="flex items-center gap-5px">
          <Lock size={12} />
          読み取り専用
        </span>
      ) : null}
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-5px text-11px text-fg3 bg-transparent border-none cursor-pointer font-inherit p-0"
      >
        <Settings size={13} />
        設定
      </button>
    </footer>
  )
}
