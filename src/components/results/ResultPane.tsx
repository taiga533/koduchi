/**
 * 結果ペイン（デザイン 3a の下段）。
 *
 * タブは内容があるときだけ出現する（ADR 0009）。通常は「結果」1 つだけであり、
 * その場合はタブ行を描かず、32px のヘッダーには行数と所要時間だけが残る。
 */

import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getClipboardApi } from '../../api/clipboard'
import { isOnSelectedText } from '../../input/nativeContextMenu'
import type { LogEntry, ScriptProgress, TabExecution, TabPlan } from '../../stores/execution'
import {
  formatResultSummary,
  formatStatementOutcome,
  selectExecution,
  selectPlan,
  selectResultTabs,
  useExecutionStore,
} from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { ErrorCopyButton } from './ErrorCopyButton'
import { MessageLogContextMenu } from './MessageLogContextMenu'
import { ResultTable } from './ResultTable'

/** タブの表示名。 */
const TAB_LABELS = {
  result: '結果',
  messages: 'メッセージ',
  plan: '実行計画',
} as const

interface ResultPaneProps {
  /** 表示するタブ。選択中のエディタタブ。 */
  tabId: string | null
  /** 実行中に出す接続名とタブ名（デザイン 5a）。 */
  runningLabel: string
  /** 実行を中止する。 */
  onCancel: () => void
  /** 続きのかたまりを要求する。 */
  onRequestMore: () => void
  /** メッセージタブのログの SQL を新しいタブに入れる。実行はしない（ADR 0038）。 */
  onOpenSqlInNewTab: (sql: string) => void
}

export function ResultPane({
  tabId,
  runningLabel,
  onCancel,
  onRequestMore,
  onOpenSqlInNewTab,
}: ResultPaneProps) {
  const execution = useExecutionStore((state) => selectExecution(state, tabId))
  const plan = useExecutionStore((state) => selectPlan(state, tabId))
  const log = useExecutionStore((state) => state.log)
  // 配列を返すセレクタは、参照が毎回変わって無限再描画になる。
  // `useShallow` で中身の比較にする。
  const tabs = useExecutionStore(useShallow((state) => selectResultTabs(state, tabId)))

  const activeTab = useUiStore((state) => state.resultTab)
  const selectTab = useUiStore((state) => state.selectResultTab)

  // 出現していないタブが選ばれたままにならないよう、無ければ結果へ戻す。
  const currentTab = tabs.includes(activeTab) ? activeTab : 'result'
  const summary = formatResultSummary(execution)

  return (
    <section className="flex-1 min-h-0 bg-panel rounded-10px border border-line overflow-hidden flex flex-col">
      <div className="h-32px flex items-center gap-3px px-8px bg-panel border-b border-line2 text-12px shrink-0">
        {tabs.length > 1
          ? tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => selectTab(tab)}
                className={`flex items-center gap-7px px-10px py-4px rounded-6px border-none cursor-pointer font-inherit text-12px ${
                  tab === currentTab ? 'bg-bg text-fg font-500' : 'bg-transparent text-fg3'
                }`}
              >
                {TAB_LABELS[tab]}
                {tab === 'messages' && execution.error ? (
                  <span className="w-5px h-5px rounded-full bg-err" />
                ) : null}
              </button>
            ))
          : null}
        <span className="flex-1" />
        <span className="text-11px text-fg3">{summary}</span>
      </div>

      <PaneBody
        tabId={tabId}
        execution={execution}
        plan={plan}
        currentTab={currentTab}
        log={log}
        runningLabel={runningLabel}
        onCancel={onCancel}
        onRequestMore={onRequestMore}
        onOpenSqlInNewTab={onOpenSqlInNewTab}
      />
    </section>
  )
}

interface PaneBodyProps {
  /** 表示中のエディタタブ。結果テーブルの作り直しと列幅の記憶に使う。 */
  tabId: string | null
  execution: TabExecution
  plan: TabPlan | null
  currentTab: string
  log: LogEntry[]
  runningLabel: string
  onCancel: () => void
  onRequestMore: () => void
  onOpenSqlInNewTab: (sql: string) => void
}

/** ペインの本文。状態に応じて実行中・エラー・結果・空状態を出し分ける。 */
function PaneBody({
  tabId,
  execution,
  plan,
  currentTab,
  log,
  runningLabel,
  onCancel,
  onRequestMore,
  onOpenSqlInNewTab,
}: PaneBodyProps) {
  if (currentTab === 'plan') {
    return <PlanView plan={plan} />
  }

  if (execution.status === 'running') {
    return <RunningState label={runningLabel} progress={execution.progress} onCancel={onCancel} />
  }

  if (currentTab === 'messages') {
    return <MessageLog log={log} error={execution.error} onOpenSqlInNewTab={onOpenSqlInNewTab} />
  }

  if (execution.status === 'discarded') {
    return <DiscardedNotice />
  }

  if (execution.status === 'failed') {
    return <FailureNotice error={execution.error} progress={execution.progress} />
  }

  if (execution.status === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center text-12.5px text-fg4">
        SQL を実行すると、ここに結果が出ます
      </div>
    )
  }

  if (execution.columns.length === 0) {
    // 行数の概念が無い文（DDL・PL/SQL ブロックなど）に「0 行に影響しました」と
    // 出さない。成功したのか空振りしたのかが読めなくなる（ADR 0034）。
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-7px">
        <p className="text-13px text-fg m-0">{formatStatementOutcome(execution.affectedRows)}</p>
        <p className="text-12px text-fg4 m-0">{execution.elapsedMs} ms</p>
      </div>
    )
  }

  // タブを切り替えたら結果テーブルを作り直し、セル選択を捨てる。列幅は `ui` ストア
  // にタブごとに残るため、作り直しても保たれる。
  return (
    <ResultTable
      key={tabId ?? 'none'}
      tabId={tabId}
      execution={execution}
      onRequestMore={onRequestMore}
    />
  )
}

/**
 * 実行計画のタブ。
 *
 * `DBMS_XPLAN` の出力は既に整形済みであるため、テキストのまま等幅で出す。
 * ツリー UI へのパースは行わない（ADR の「実行計画」節）。
 */
function PlanView({ plan }: { plan: TabPlan | null }) {
  if (!plan || plan.status === 'running') {
    return (
      <div className="flex-1 flex items-center justify-center text-12.5px text-fg4">
        実行計画を生成しています…
      </div>
    )
  }

  if (plan.status === 'failed') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px">
        <p className="text-12px text-err text-center m-0 max-w-560px break-words">{plan.error}</p>
        {plan.error ? <ErrorCopyButton text={plan.error} /> : null}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto select-text px-14px py-13px">
      <p className="m-0 mb-8px text-10.5px text-fg4">
        {plan.mode === 'estimate' ? '見積り（実行していません）' : '実測付き'}
      </p>
      <pre className="m-0 text-11px leading-[1.5] text-fg2 whitespace-pre">{plan.text}</pre>
    </div>
  )
}

/**
 * 実行中の表示（デザイン 5a）。
 *
 * スクリプト実行（`⌥⌘⏎`）では、何文目を投げているところかを出す。
 */
function RunningState({
  label,
  progress,
  onCancel,
}: {
  label: string
  progress: ScriptProgress | null
  onCancel: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-11px">
      <div className="w-232px h-3px rounded-2px bg-line2 overflow-hidden">
        <div className="w-96px h-3px rounded-2px bg-ac" />
      </div>
      <p className="text-12.5px text-fg m-0">
        {progress ? `${progress.index} / ${progress.total} 文目を実行中` : 'クエリを実行中'}
      </p>
      <p className="text-11px text-fg4 m-0">{label}</p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4px px-14px py-6px rounded-8px bg-panel border border-line text-12.5px font-600 text-fg cursor-pointer font-inherit"
      >
        中止
      </button>
    </div>
  )
}

/**
 * 結果セットが閉じられたときの表示（ADR 0003）。
 *
 * 接続プールの本数を超えたため、最も長く使われていなかったこのタブの結果セットが
 * 閉じられた。行は再取得できないため、再実行を促す。
 */
function DiscardedNotice() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px">
      <p className="text-13px text-fg m-0">結果は破棄されました</p>
      <p className="text-12px text-fg4 m-0 text-center leading-[1.6]">
        別のタブで実行したため、この結果セットは閉じられました。再実行してください。
      </p>
    </div>
  )
}

/**
 * 失敗の通知。
 *
 * 詳細はメッセージタブに出るため、ここでは要点だけを示す。エラー表示は
 * テキストのみとし、波線や候補の提示は行わない（ADR の機能スコープ）。
 */
function FailureNotice({
  error,
  progress,
}: {
  error: string | null
  progress: ScriptProgress | null
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px">
      {progress ? (
        <p className="text-12.5px text-fg m-0">
          {progress.total} 文中 {progress.index} 文目で失敗しました。以降の文は実行していません。
        </p>
      ) : null}
      {/* コンパイルエラー（ADR 0045）は字下げした行で診断を並べるため、改行を
          活かして左に揃える。1 行の文言は幅が縮むので中央に置いたときと変わらない。 */}
      <p className="text-12px text-err text-left m-0 max-w-560px break-words whitespace-pre-wrap">
        {error}
      </p>
      {error ? <ErrorCopyButton text={error} /> : null}
      <p className="text-11.5px text-fg4 m-0">詳細はメッセージタブに残ります</p>
    </div>
  )
}

interface MessageLogProps {
  log: LogEntry[]
  error: string | null
  onOpenSqlInNewTab: (sql: string) => void
}

/** メッセージタブのログの右クリックメニューの状態。 */
interface LogMenuState {
  x: number
  y: number
  entry: LogEntry
}

/**
 * メッセージタブ。実行ログを時系列で積む。
 *
 * ログ 1 件の右クリックでメニューを出す（ADR 0038。`MessageLogContextMenu.tsx`）。
 * スクリプト実行で失敗した 1 文を取り出して直す道が他に無いためである。
 * **選んだ文字の上の右クリックはウェブビューのメニューに任せる。**ここは
 * なぞって写す場所でもあり（`select-text`）、選んだ部分だけを写す「コピー」を
 * 奪わない。
 */
function MessageLog({ log, error, onOpenSqlInNewTab }: MessageLogProps) {
  const [menu, setMenu] = useState<LogMenuState | null>(null)

  if (log.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-9px text-12.5px text-fg4">
        {error ?? '実行のログがここに残ります'}
        {error ? <ErrorCopyButton text={error} /> : null}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto select-text px-14px py-13px flex flex-col gap-14px text-11.5px">
      {log.map((entry) => (
        <div
          key={entry.id}
          data-testid={`message-log-${entry.id}`}
          className="flex flex-col gap-5px"
          onContextMenu={(event) => {
            const point = { x: event.clientX, y: event.clientY }
            if (isOnSelectedText(point, window.getSelection())) {
              return
            }
            event.preventDefault()
            // 写すものが無い報せ（コミットしました、など）ではメニューを出さない。
            if (entry.kind === 'statement' || entry.error !== null) {
              setMenu({ x: event.clientX, y: event.clientY, entry })
            }
          }}
        >
          <div className="flex items-center gap-10px text-10.5px text-fg4">
            <span>{entry.startedAt.toLocaleTimeString('ja-JP')}</span>
            {entry.statement ? (
              <span>
                {entry.statement.index} / {entry.statement.total} 文目
              </span>
            ) : null}
            {entry.elapsedMs !== null ? <span>{entry.elapsedMs} ms</span> : null}
            {entry.rowCount !== null ? (
              <span>{entry.rowCount.toLocaleString('ja-JP')} 行</span>
            ) : null}
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words text-fg2 leading-[1.6]">
            {entry.sql}
          </pre>
          {entry.error ? (
            <>
              <pre className="m-0 whitespace-pre-wrap break-words text-err leading-[1.6]">
                {entry.error}
              </pre>
              <div>
                <ErrorCopyButton text={entry.error} />
              </div>
            </>
          ) : null}
          {entry.notices.map((notice, index) => (
            <pre
              key={`${entry.id}-${index}`}
              className="m-0 whitespace-pre-wrap break-words text-fg3 leading-[1.6]"
            >
              {notice}
            </pre>
          ))}
        </div>
      ))}
      {menu ? (
        <MessageLogContextMenu
          x={menu.x}
          y={menu.y}
          entry={menu.entry}
          onCopySql={() => void getClipboardApi().writeText(menu.entry.sql)}
          onOpenInNewTab={() => onOpenSqlInNewTab(menu.entry.sql)}
          onCopyError={() => {
            if (menu.entry.error !== null) {
              void getClipboardApi().writeText(menu.entry.error)
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
