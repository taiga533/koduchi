/**
 * 3 パネル構成の枠。
 *
 * タイトルバー・本体・ステータスバーを縦に並べる。本体の中身は呼び出し側が渡す。
 * 設定画面・CSV の保存ダイアログ・コマンドパレットは、この枠の上に重ねる。
 *
 * 切断はステータスバーの接続状態から呼ぶ。「切断」と「別の接続へ切り替え…」は
 * どちらも同じ動きであるため、受け取る手続きは 1 つでよい。
 */

import type { ReactNode } from 'react'
import { StatusBar } from '../statusbar/StatusBar'
import { TitleBar } from '../titlebar/TitleBar'
import { SessionSaver } from './SessionSaver'

interface ShellProps {
  children: ReactNode
  onOpenSettings: () => void
  onDisconnect: () => void
  /** セッションとロックのパネルを開く（ADR 0017）。接続中の画面だけが渡す。 */
  onOpenSessions?: () => void
  /**
   * オブジェクトのソース検索のパネルを開く（`⇧⌘F`、ADR 0021）。
   * 接続中の画面だけが渡す。
   */
  onOpenSourceSearch?: () => void
  /** `⌥⌘C`。トランザクションをコミットする（ADR 0012）。 */
  onCommit?: () => void
  /** `⌥⌘R`。トランザクションをロールバックする（ADR 0012）。 */
  onRollback?: () => void
  /** 同じ接続先へ繋ぎ直す（ADR 0026）。接続中の画面だけが渡す。 */
  onReconnect?: () => void
  /** `⌘K`。コマンドパレットを開く（ADR 0018）。接続中の画面だけが渡す。 */
  onOpenPalette?: () => void
  overlay?: ReactNode
}

export function Shell({
  children,
  onOpenSettings,
  onDisconnect,
  onOpenSessions,
  onOpenSourceSearch,
  onCommit,
  onRollback,
  onReconnect,
  onOpenPalette,
  overlay,
}: ShellProps) {
  return (
    <div className="relative h-full flex flex-col bg-bg">
      <SessionSaver />
      <TitleBar onOpenPalette={onOpenPalette} />
      <div className="flex-1 min-h-0 flex gap-6px p-6px">{children}</div>
      <StatusBar
        onOpenSettings={onOpenSettings}
        onDisconnect={onDisconnect}
        onSwitchConnection={onDisconnect}
        onOpenSessions={onOpenSessions}
        onOpenSourceSearch={onOpenSourceSearch}
        onCommit={onCommit}
        onRollback={onRollback}
        onReconnect={onReconnect}
      />
      {overlay}
    </div>
  )
}
