/**
 * ステータスバー（デザイン 3a の最下段）。
 *
 * カーソル位置・文字コード・データベースの種別・接続状態・読み取り専用の別と、
 * 設定への入口を並べる。手動コミットの接続では、その並びに未コミットの表示と
 * コミット / ロールバックのボタンが加わる（ADR 0012）。
 *
 * カーソル位置は `ui` ストアから読む。打鍵のたびにアプリ全体を描き直さず、
 * ここだけが更新されるようにするためである。
 *
 * 接続中の表示は押せるようにしてあり、そこから切断と接続の切り替えへ進む。
 * 1 接続 = 1 ウィンドウ（ADR 0009）であるため、接続を操作する場所はこの
 * 「今どこへ繋がっているか」を出している所が自然である。
 *
 * サーバ側で接続が切れているときは、「接続中」の代わりに「接続が切れました」を
 * `--warn` で出し、その隣に「再接続」を置く（ADR 0026）。ADR 0012 の「未コミット」と
 * コミット / ロールバックのボタンと同じ並びであり、**状態のすぐ隣にその状態を
 * 片付ける手を置く**という形を繰り返している。**自動では繋ぎ直さない。**
 * 繋ぎ直した接続は別のセッションであり、未コミットの変更はサーバ側で既に
 * ロールバックされている。押させることが、その事実を見せる機会でもある。
 *
 * 切れている間はコミット / ロールバックのボタンを出さない。押しても届かない
 * うえ、未コミットの状態はもう残っていない。
 *
 * 接続に色が付いていれば「接続中」の手前に色の印を置く（ADR 0015）。ここは
 * 補助であり、色そのものを届ける主役はタイトルバー上端の帯である。読み取り専用は
 * 色ではなく鍵のアイコン（形）で示し続ける。色は「どの接続か」、形は「何ができるか」
 * を表す別々の軸であり、混ぜると読み分けられなくなる。
 */

import { useState } from 'react'
import {
  Activity,
  ArrowLeftRight,
  Check,
  ChevronUp,
  FileSearch,
  Lock,
  PlugZap,
  Settings,
  Undo2,
  Unplug,
} from 'lucide-react'
import { canReachDatabase, isManualCommit, useConnectionStore } from '../../stores/connection'
import { CONNECTION_LOST_LABEL } from '../../connection/lost'
import { useExecutionStore } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { connectionColorVar } from '../../theme/connectionColors'

interface StatusBarProps {
  /** 設定画面を開く。 */
  onOpenSettings: () => void
  /** 接続を切って接続を選ぶ画面へ戻る。 */
  onDisconnect: () => void
  /** 接続を切り替える。切断して接続を選ぶ画面を出す。 */
  onSwitchConnection: () => void
  /**
   * セッションとロックのパネルを開く（ADR 0017）。
   *
   * 渡さないとメニューに項目が出ない。接続していない画面では意味を持たない
   * ためである。
   */
  onOpenSessions?: () => void
  /**
   * オブジェクトのソース検索のパネルを開く（`⇧⌘F`、ADR 0021）。
   *
   * 渡さないとメニューに項目が出ない。接続していない画面では意味を持たない
   * ためである。
   */
  onOpenSourceSearch?: () => void
  /** `⌥⌘C`。トランザクションをコミットする（ADR 0012）。 */
  onCommit?: () => void
  /** `⌥⌘R`。トランザクションをロールバックする（ADR 0012）。 */
  onRollback?: () => void
  /**
   * 同じ接続先へ繋ぎ直す（ADR 0026）。
   *
   * 接続が切れているときだけ押せる。渡さないとボタンが出ない。
   */
  onReconnect?: () => void
}

/** 接続の段階を利用者向けの文言にする。 */
const STATUS_LABELS = {
  disconnected: '未接続',
  connecting: '接続中…',
  connected: '接続中',
  failed: '接続失敗',
  lost: CONNECTION_LOST_LABEL,
} as const

/** 接続中を示す緑。トークンに無い色であるため、この 1 箇所で持つ。 */
const CONNECTED_COLOR = 'oklch(0.58 0.12 152)'

export function StatusBar({
  onOpenSettings,
  onDisconnect,
  onSwitchConnection,
  onOpenSessions,
  onOpenSourceSearch,
  onCommit,
  onRollback,
  onReconnect,
}: StatusBarProps) {
  const status = useConnectionStore((state) => state.status)
  const connection = useConnectionStore((state) => state.connection)
  const cursor = useUiStore((state) => state.cursor)
  const inTransaction = useExecutionStore((state) => state.inTransaction)

  // 読み取り専用と自動コミットの接続では、コミットすべき変更がそもそも生じない。
  // 切れている間は往復そのものが届かないため、同じく出さない（ADR 0026）。
  const 手動コミット = isManualCommit(connection) && canReachDatabase(status)

  return (
    <footer className="h-26px flex items-center gap-16px px-14px bg-bg text-11px text-fg3 shrink-0">
      <span>
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <span>UTF-8</span>
      {connection ? <span>Oracle</span> : null}
      <span className="flex-1" />
      {status === 'connected' ? (
        <ConnectionMenu
          onDisconnect={onDisconnect}
          onSwitchConnection={onSwitchConnection}
          onOpenSessions={onOpenSessions}
          onOpenSourceSearch={onOpenSourceSearch}
        />
      ) : status === 'lost' ? (
        <LostConnection onReconnect={onReconnect} onDisconnect={onDisconnect} />
      ) : (
        <span>{STATUS_LABELS[status]}</span>
      )}
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
 * 接続が切れていることと、そこから戻る手（ADR 0026）。
 *
 * 「再接続」は同じ接続先へ繋ぎ直す。「切断」は接続を選ぶ画面へ戻る。繋ぎ直せない
 * 相手（停止中のデータベース、期限切れのパスワード）のときに袋小路へ入らない
 * よう、2 つめの道を残してある。
 *
 * メニューにはしない。切れている状態は片手で終わらせたいものであり、
 * 押しどころを 1 段隠すと「どうすればよいか分からない」に逆戻りする。
 */
function LostConnection({
  onReconnect,
  onDisconnect,
}: {
  onReconnect?: () => void
  onDisconnect: () => void
}) {
  return (
    <span className="flex items-center gap-10px">
      <span className="text-warn">{STATUS_LABELS.lost}</span>
      {onReconnect ? (
        <TransactionButton label="再接続" shortcut="" onClick={onReconnect}>
          <PlugZap size={12} />
        </TransactionButton>
      ) : null}
      <TransactionButton label="切断" shortcut="" onClick={onDisconnect}>
        <Unplug size={12} />
      </TransactionButton>
    </span>
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
  /** 打鍵の割り当て。持たないボタンでは空文字列を渡す。 */
  shortcut: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut === '' ? label : `${label}（${shortcut}）`}
      className="flex items-center gap-5px text-11px text-fg3 bg-transparent border-none cursor-pointer font-inherit p-0"
    >
      {children}
      {label}
    </button>
  )
}

/**
 * 接続中の表示から開くメニュー。
 *
 * 項目は「切断」と「別の接続へ切り替え…」の 2 つで、どちらも接続を閉じて
 * 接続を選ぶ画面へ戻る。同じ動きに 2 つの入口を置いてあるのは、切り替えの
 * つもりの利用者に「切断」しか見えないと、その道が無いように見えるためである。
 *
 * セッションとロック（ADR 0017）とオブジェクトのソース検索（ADR 0021）も
 * ここから開く。「今どこへ繋がっているか」を出している所は、そのデータベースの
 * 中身を覗く入口としても自然である。
 *
 * ステータスバーは画面の最下段にあるため、メニューは上へ開く。
 */
function ConnectionMenu({
  onDisconnect,
  onSwitchConnection,
  onOpenSessions,
  onOpenSourceSearch,
}: {
  onDisconnect: () => void
  onSwitchConnection: () => void
  onOpenSessions?: () => void
  onOpenSourceSearch?: () => void
}) {
  const [open, setOpen] = useState(false)
  const color = useConnectionStore((state) => state.connection?.color ?? 'none')
  const 接続の色 = connectionColorVar(color)

  /** 項目を選んだときの共通処理。メニューを閉じてから実行する。 */
  const select = (work: () => void) => {
    setOpen(false)
    work()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-4px px-5px py-1px rounded-5px text-11px bg-transparent border-none cursor-pointer font-inherit hover:bg-fill"
        style={{ color: CONNECTED_COLOR }}
      >
        {接続の色 ? (
          <span
            data-testid="connection-color-mark"
            data-connection-color={color}
            aria-hidden="true"
            className="w-7px h-7px rounded-2px"
            style={{ background: 接続の色 }}
          />
        ) : null}
        {STATUS_LABELS.connected}
        <ChevronUp size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-24px z-10 w-208px p-5px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-1px"
        >
          <MenuItem
            icon={<Unplug size={13} />}
            label="切断"
            onSelect={() => select(onDisconnect)}
          />
          <MenuItem
            icon={<ArrowLeftRight size={13} />}
            label="別の接続へ切り替え…"
            onSelect={() => select(onSwitchConnection)}
          />
          {onOpenSessions ? (
            <MenuItem
              icon={<Activity size={13} />}
              label="セッションとロック…"
              onSelect={() => select(onOpenSessions)}
            />
          ) : null}
          {onOpenSourceSearch ? (
            <MenuItem
              icon={<FileSearch size={13} />}
              label="ソースを検索…"
              onSelect={() => select(onOpenSourceSearch)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * メニューの 1 項目。
 *
 * @param icon 左に置くアイコン
 * @param label 項目の文言
 * @param onSelect 選んだときに呼ぶ
 */
function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-8px w-full px-8px py-6px rounded-7px bg-transparent border-none cursor-pointer font-inherit text-11.5px text-fg text-left hover:bg-fill"
    >
      <span className="flex items-center text-fg4">{icon}</span>
      {label}
    </button>
  )
}
