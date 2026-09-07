/**
 * ステータスバー（デザイン 3a の最下段）。
 *
 * カーソル位置・文字コード・データベースの種別・接続状態・読み取り専用の別と、
 * 設定への入口を並べる。手動コミットの接続では、その並びに未コミットの表示と
 * コミット / ロールバックのボタンが加わる（ADR 0012）。
 *
 * カーソル位置は `ui` ストアから読む。打鍵のたびにアプリ全体を描き直さず、
 * ここだけが更新されるようにするためである。
 */

import { Check, Lock, Settings, Undo2 } from 'lucide-react'
import { isManualCommit, useConnectionStore } from '../../stores/connection'
import { useExecutionStore } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'

interface StatusBarProps {
  /** 設定画面を開く。 */
  onOpenSettings: () => void
  /** `⌥⌘C`。トランザクションをコミットする。 */
  onCommit?: () => void
  /** `⌥⌘R`。トランザクションをロールバックする。 */
  onRollback?: () => void
}

/** 接続の段階を利用者向けの文言にする。 */
const STATUS_LABELS = {
  disconnected: '未接続',
  connecting: '接続中…',
  connected: '接続中',
  failed: '接続失敗',
} as const

export function StatusBar({ onOpenSettings, onCommit, onRollback }: StatusBarProps) {
  const status = useConnectionStore((state) => state.status)
  const connection = useConnectionStore((state) => state.connection)
  const cursor = useUiStore((state) => state.cursor)
  const inTransaction = useExecutionStore((state) => state.inTransaction)

  // 読み取り専用と自動コミットの接続では、コミットすべき変更がそもそも生じない。
  const 手動コミット = isManualCommit(connection)

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
      {手動コミット && inTransaction ? <span className="text-warn">未コミット</span> : null}
      {手動コミット ? (
        <span className="flex items-center gap-10px">
          <TransactionButton label="コミット" shortcut="⌥⌘C" onClick={onCommit}>
            <Check size={12} />
          </TransactionButton>
          <TransactionButton label="ロールバック" shortcut="⌥⌘R" onClick={onRollback}>
            <Undo2 size={12} />
          </TransactionButton>
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

/**
 * コミット / ロールバックのボタン（ADR 0012）。
 *
 * 未コミットが無いときに押しても害は無いため、押せる状態は変えない。押せたり
 * 押せなかったりが実行のたびに切り替わるほうが、押し所を見失わせる。
 */
function TransactionButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}（${shortcut}）`}
      className="flex items-center gap-5px text-11px text-fg3 bg-transparent border-none cursor-pointer font-inherit p-0"
    >
      {children}
      {label}
    </button>
  )
}
