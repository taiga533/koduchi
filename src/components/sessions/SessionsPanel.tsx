/**
 * セッションとロックのパネル（ADR 0017）。
 *
 * ステータスバーの「接続中」のメニューから開く。`V$SESSION` の一覧・ブロッキングの
 * 連鎖・他セッションの kill を 1 枚に収めてある。結果ペインのタブにしないのは、
 * あのタブがエディタタブごとの実行結果に紐付いているためである（ADR 0009）。
 *
 * 取得はプールの結果セットを保持していない接続で行われるため、開いている結果は
 * 何度読み直しても壊れない（ADR 0003）。
 *
 * kill の関所は 3 つある。読み取り専用の接続と小槌自身の接続には**ボタンを
 * 出さない**（残りの 2 つは Rust 側にあり、UI を直しても通らない）。押した先では
 * 必ず確認を挟む。
 */

import { useEffect, useMemo } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import {
  AUTO_REFRESH_INTERVAL,
  countBlockedSessions,
  filterSessions,
  useSessionsStore,
} from '../../stores/sessions'
import type { BlockingNode, SessionRow } from '../../types/db'

interface SessionsPanelProps {
  /** 接続の識別子。 */
  connectionId: string
  /**
   * 読み取り専用の接続か（ADR 0004）。
   *
   * 真のときは kill のボタンを出さない。弾かれるボタンを見せないためである。
   */
  readOnly: boolean
  /** パネルを閉じる。 */
  onClose: () => void
}

export function SessionsPanel({ connectionId, readOnly, onClose }: SessionsPanelProps) {
  const overview = useSessionsStore((state) => state.overview)
  const status = useSessionsStore((state) => state.status)
  const error = useSessionsStore((state) => state.error)
  const permissionDenied = useSessionsStore((state) => state.permissionDenied)
  const search = useSessionsStore((state) => state.search)
  const setSearch = useSessionsStore((state) => state.setSearch)
  const autoRefresh = useSessionsStore((state) => state.autoRefresh)
  const toggleAutoRefresh = useSessionsStore((state) => state.toggleAutoRefresh)
  const load = useSessionsStore((state) => state.load)
  const killTarget = useSessionsStore((state) => state.killTarget)
  const killError = useSessionsStore((state) => state.killError)
  const requestKill = useSessionsStore((state) => state.requestKill)
  const cancelKill = useSessionsStore((state) => state.cancelKill)
  const confirmKill = useSessionsStore((state) => state.confirmKill)

  // 開いた時点で 1 度読む。
  useEffect(() => {
    void load(connectionId)
  }, [connectionId, load])

  // 自動更新はパネルが開いている間だけ回る。閉じると部品ごと消えるため、
  // この後片付けで間隔も止まる（ADR 0017）。
  useEffect(() => {
    if (!autoRefresh) {
      return
    }
    const timer = setInterval(() => void load(connectionId), AUTO_REFRESH_INTERVAL)
    return () => clearInterval(timer)
  }, [autoRefresh, connectionId, load])

  // 確認の最中の `esc` は確認だけを取り消す。パネルまで閉じると、押し間違いを
  // 取り消したつもりで一覧まで失う。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (useSessionsStore.getState().killTarget) {
        cancelKill()
        return
      }
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelKill, onClose])

  const sessions = useMemo(
    () => filterSessions(overview?.sessions ?? [], search),
    [overview, search],
  )
  const blocked = countBlockedSessions(overview)

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px">
      <section
        role="dialog"
        aria-label="セッションとロック"
        className="w-880px max-w-full max-h-full overflow-hidden bg-panel rounded-10px border border-line p-18px flex flex-col gap-12px"
      >
        <div className="flex items-center gap-12px">
          <h2 className="text-14px font-600 text-fg m-0">セッションとロック</h2>
          <span className="flex-1" />
          <label className="flex items-center gap-6px text-11.5px text-fg3 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={() => toggleAutoRefresh()} />
            {AUTO_REFRESH_INTERVAL / 1000} 秒ごとに更新
          </label>
          <button
            type="button"
            onClick={() => void load(connectionId)}
            className="flex items-center gap-6px px-10px py-4px rounded-7px bg-fill border-none text-11.5px text-fg cursor-pointer font-inherit"
          >
            <RefreshCw size={13} className="text-fg4" />
            更新
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="セッションとロックを閉じる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex items-center gap-8px px-9px py-4px rounded-7px bg-fill">
          <Search size={14} className="text-fg5 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="SID・ユーザー・プログラムで絞り込む"
            aria-label="セッションを絞り込む"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-12px text-fg font-inherit placeholder:text-fg4"
          />
        </div>

        {killError ? (
          <p className="m-0 px-10px py-7px rounded-7px bg-fill text-11.5px text-err">{killError}</p>
        ) : null}

        <PanelBody
          status={status}
          error={error}
          permissionDenied={permissionDenied}
          sessions={sessions}
          chains={overview?.chains ?? []}
          blocked={blocked}
          currentSid={overview?.currentSid ?? null}
          instance={overview?.instance ?? 1}
          readOnly={readOnly}
          onKill={requestKill}
        />

        {killTarget ? (
          <KillConfirm
            target={killTarget}
            onCancel={cancelKill}
            onConfirm={() => void confirmKill(connectionId)}
          />
        ) : null}
      </section>
    </div>
  )
}

interface PanelBodyProps {
  status: string
  error: string | null
  permissionDenied: boolean
  sessions: SessionRow[]
  chains: BlockingNode[]
  blocked: number
  currentSid: number | null
  instance: number
  readOnly: boolean
  onKill: (session: SessionRow) => void
}

/** パネルの本文。権限不足・失敗・読み込み中・空・一覧を出し分ける。 */
function PanelBody({
  status,
  error,
  permissionDenied,
  sessions,
  chains,
  blocked,
  currentSid,
  instance,
  readOnly,
  onKill,
}: PanelBodyProps) {
  // 権限が無いことを空の一覧で表さない。「見えない」と「居ない」は別物である。
  if (permissionDenied) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px py-32px">
        <p className="text-13px text-fg m-0">この接続では V$SESSION を参照できません</p>
        <p className="text-11.5px text-fg4 m-0 text-center leading-[1.6] max-w-560px break-words">
          {error}
        </p>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex-1 flex items-center justify-center px-24px py-32px">
        <p className="text-12px text-err text-center m-0 max-w-560px break-words">{error}</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center py-32px text-12.5px text-fg4">
        セッションを読み込んでいます…
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-12px">
      <BlockingSummary chains={chains} blocked={blocked} />
      {sessions.length === 0 ? (
        <p className="m-0 py-32px text-center text-12.5px text-fg4">
          当てはまるセッションがありません
        </p>
      ) : (
        <SessionTable
          sessions={sessions}
          currentSid={currentSid}
          instance={instance}
          readOnly={readOnly}
          onKill={onKill}
        />
      )}
    </div>
  )
}

/**
 * ブロッキングの連鎖（ADR 0017）。
 *
 * 連鎖の組み立ては Rust 側の純粋な関数が済ませてある。ここは木を描くだけである。
 */
function BlockingSummary({ chains, blocked }: { chains: BlockingNode[]; blocked: number }) {
  if (chains.length === 0) {
    return <p className="m-0 text-11.5px text-fg4">ロック待ちのセッションはありません</p>
  }

  return (
    <div className="flex flex-col gap-7px p-11px rounded-8px bg-fill">
      <p className="m-0 text-12px text-warn font-500">{blocked} セッションが待たされています</p>
      <ul className="m-0 pl-0 list-none flex flex-col gap-4px">
        {chains.map((node) => (
          <ChainNode key={node.sid} node={node} depth={0} />
        ))}
      </ul>
    </div>
  )
}

/** 連鎖の 1 節点。待たせている側を上に、待っている側を下へ字下げして並べる。 */
function ChainNode({ node, depth }: { node: BlockingNode; depth: number }) {
  return (
    <li className="m-0 flex flex-col gap-4px" style={{ paddingLeft: `${depth * 16}px` }}>
      <span className="text-11.5px text-fg2">
        {depth === 0 ? `SID ${node.sid}（連鎖の根）` : `↳ SID ${node.sid}`}
      </span>
      {node.blocked.map((child) => (
        <ChainNode key={child.sid} node={child} depth={depth + 1} />
      ))}
    </li>
  )
}

/** セッションの一覧。 */
function SessionTable({
  sessions,
  currentSid,
  instance,
  readOnly,
  onKill,
}: {
  sessions: SessionRow[]
  currentSid: number | null
  instance: number
  readOnly: boolean
  onKill: (session: SessionRow) => void
}) {
  return (
    <table className="w-full border-collapse text-11.5px">
      <thead>
        <tr className="text-fg4 text-left">
          <th className="font-500 py-5px pr-8px">SID</th>
          <th className="font-500 py-5px pr-8px">ユーザー</th>
          <th className="font-500 py-5px pr-8px">状態</th>
          <th className="font-500 py-5px pr-8px">待機イベント</th>
          <th className="font-500 py-5px pr-8px">待機</th>
          <th className="font-500 py-5px pr-8px">プログラム</th>
          <th className="font-500 py-5px pr-8px">ブロック元</th>
          <th className="font-500 py-5px" />
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={`${session.sid}-${session.serial}`} className="border-t border-line2 text-fg2">
            <td className="py-6px pr-8px whitespace-nowrap">
              {session.sid},{session.serial}
              {session.sid === currentSid ? (
                <span className="ml-6px text-10.5px text-fg4">この接続</span>
              ) : session.own ? (
                <span className="ml-6px text-10.5px text-fg4">小槌</span>
              ) : null}
            </td>
            <td className="py-6px pr-8px whitespace-nowrap">{session.username ?? '—'}</td>
            <td className="py-6px pr-8px whitespace-nowrap">{session.status}</td>
            <td className="py-6px pr-8px max-w-220px truncate" title={session.event ?? ''}>
              {session.event ?? '—'}
            </td>
            <td className="py-6px pr-8px whitespace-nowrap">{session.secondsInWait} 秒</td>
            <td className="py-6px pr-8px max-w-160px truncate" title={session.program ?? ''}>
              {session.program ?? '—'}
            </td>
            <td className="py-6px pr-8px whitespace-nowrap">
              <BlockedBy session={session} instance={instance} />
            </td>
            <td className="py-6px text-right whitespace-nowrap">
              {readOnly || session.own ? null : (
                <button
                  type="button"
                  onClick={() => onKill(session)}
                  aria-label={`SID ${session.sid} を終了`}
                  className="px-8px py-3px rounded-6px bg-transparent border border-line text-11px text-fg3 cursor-pointer font-inherit"
                >
                  終了…
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 待たせている相手の表示。
 *
 * 別インスタンスの相手は一覧に並ばないため、その旨を添える（ADR 0017）。
 */
function BlockedBy({ session, instance }: { session: SessionRow; instance: number }) {
  if (session.blockingSession === null) {
    return <span className="text-fg4">—</span>
  }

  const 別インスタンス = session.blockingInstance !== null && session.blockingInstance !== instance

  return (
    <span className="text-warn">
      SID {session.blockingSession}
      {別インスタンス ? `（インスタンス ${session.blockingInstance}）` : ''}
    </span>
  )
}

/**
 * kill の確認（ADR 0017 の関所 3）。
 *
 * 対象を読み上げてから尋ねる。押し間違いで他人の仕事を落とさないためである。
 */
function KillConfirm({
  target,
  onCancel,
  onConfirm,
}: {
  target: SessionRow
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(24,28,38,.36)] p-24px">
      <section
        role="dialog"
        aria-label="セッションの終了を確認"
        className="w-420px max-w-full bg-panel rounded-10px border border-line p-18px flex flex-col gap-12px"
      >
        <h3 className="m-0 text-13px font-600 text-fg">このセッションを終了しますか？</h3>
        <dl className="m-0 grid grid-cols-[80px_1fr] gap-x-10px gap-y-5px text-11.5px">
          <dt className="text-fg4">SID</dt>
          <dd className="m-0 text-fg2">
            {target.sid},{target.serial}
          </dd>
          <dt className="text-fg4">ユーザー</dt>
          <dd className="m-0 text-fg2">{target.username ?? '—'}</dd>
          <dt className="text-fg4">プログラム</dt>
          <dd className="m-0 text-fg2 break-words">{target.program ?? '—'}</dd>
          <dt className="text-fg4">マシン</dt>
          <dd className="m-0 text-fg2 break-words">{target.machine ?? '—'}</dd>
        </dl>
        <p className="m-0 text-11.5px text-fg4 leading-[1.6]">
          ALTER SYSTEM KILL SESSION を発行します。実行中の処理は中断され、未コミットの変更は
          ロールバックされます。取り消せません。
        </p>
        <div className="flex justify-end gap-8px">
          <button
            type="button"
            onClick={onCancel}
            className="px-14px py-6px rounded-8px bg-fill border-none text-12px text-fg cursor-pointer font-inherit"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-14px py-6px rounded-8px bg-err border-none text-12px text-panel font-600 cursor-pointer font-inherit"
          >
            終了する
          </button>
        </div>
      </section>
    </div>
  )
}
