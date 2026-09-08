/**
 * オブジェクトのソース検索のパネル（ADR 0021）。
 *
 * ステータスバーの「接続中」のメニューか `⇧⌘F` で開く。`ALL_SOURCE` を横断して
 * 「この文字列を含む処理はどれか」を探し、当たりをオブジェクト単位に束ねて出す。
 * 選んだ当たり行の前後は、選んだときに読みに行く（全文は読まない）。
 *
 * セッションとロック（ADR 0017）と同じオーバーレイに載せてある。結果ペインの
 * タブにしないのは、あのタブがエディタタブごとの実行結果に紐付いているため
 * である（ADR 0009）。サイドバーに載せないのは、当たった行の本文を出す幅が
 * 無いためである。
 *
 * 取得はプールの結果セットを保持していない接続で行われるため、開いている結果は
 * 何度探し直しても壊れない（ADR 0003）。
 *
 * **打鍵のたびには投げない。** パレット（ADR 0018）は取得済みのものを打鍵ごとに
 * 絞る速い道具、ここはデータベースへ投げて待つ道具である。
 */

import { useEffect } from 'react'
import { FileCode2, Search, X } from 'lucide-react'
import { useSchemaStore } from '../../stores/schema'
import {
  canSearch,
  summarizeSourceResult,
  useSourceSearchStore,
  type SelectedMatch,
} from '../../stores/sourceSearch'
import type { SourceKind, SourceLine, SourceObjectMatches } from '../../types/db'
import { SOURCE_KIND_LABELS, SOURCE_KIND_ORDER } from '../../types/db'
import { blockComposingSubmit, isComposingKey } from '../../input/ime'

interface SourceSearchPanelProps {
  /** 接続の識別子。 */
  connectionId: string
  /** パネルを閉じる。 */
  onClose: () => void
}

export function SourceSearchPanel({ connectionId, onClose }: SourceSearchPanelProps) {
  const needle = useSourceSearchStore((state) => state.needle)
  const setNeedle = useSourceSearchStore((state) => state.setNeedle)
  const owner = useSourceSearchStore((state) => state.owner)
  const setOwner = useSourceSearchStore((state) => state.setOwner)
  const kinds = useSourceSearchStore((state) => state.kinds)
  const toggleKind = useSourceSearchStore((state) => state.toggleKind)
  const caseSensitive = useSourceSearchStore((state) => state.caseSensitive)
  const setCaseSensitive = useSourceSearchStore((state) => state.setCaseSensitive)
  const search = useSourceSearchStore((state) => state.search)
  const result = useSourceSearchStore((state) => state.result)
  const status = useSourceSearchStore((state) => state.status)
  const error = useSourceSearchStore((state) => state.error)
  const permissionDenied = useSourceSearchStore((state) => state.permissionDenied)
  const selected = useSourceSearchStore((state) => state.selected)
  const select = useSourceSearchStore((state) => state.select)
  const clearSelection = useSourceSearchStore((state) => state.clearSelection)

  const schemas = useSchemaStore((state) => state.schemas)

  // 前後を見ている最中の `esc` は選択だけを解く。パネルまで閉じると、
  // 1 件を覗いたつもりで検索の結果ごと失う（セッションのパネルと同じ考え方）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 変換中の `esc` は変換の取り消しである（ADR 0025）。
      if (event.key !== 'Escape' || isComposingKey(event)) {
        return
      }
      if (useSourceSearchStore.getState().selected) {
        clearSelection()
        return
      }
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, onClose])

  const 探せる = canSearch(needle)

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px">
      <section
        role="dialog"
        aria-label="オブジェクトのソース検索"
        className="w-960px max-w-full max-h-full overflow-hidden bg-panel rounded-10px border border-line p-18px flex flex-col gap-12px"
      >
        <div className="flex items-center gap-12px">
          <h2 className="text-14px font-600 text-fg m-0">オブジェクトのソース検索</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="ソース検索を閉じる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <form
          className="flex items-center gap-8px"
          onKeyDown={blockComposingSubmit}
          onSubmit={(event) => {
            event.preventDefault()
            void search(connectionId)
          }}
        >
          <div className="flex-1 min-w-0 flex items-center gap-8px px-9px py-4px rounded-7px bg-fill">
            <Search size={14} className="text-fg5 shrink-0" />
            <input
              autoFocus
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="ソースに含まれる文字列"
              aria-label="ソースに含まれる文字列"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-12px text-fg font-inherit placeholder:text-fg4"
            />
          </div>

          <label className="flex items-center gap-6px text-11.5px text-fg3">
            スキーマ
            <select
              value={owner ?? ''}
              onChange={(event) => setOwner(event.target.value === '' ? null : event.target.value)}
              aria-label="探す先のスキーマ"
              className="px-7px py-3px rounded-6px bg-fill border-none text-11.5px text-fg font-inherit cursor-pointer"
            >
              <option value="">すべて</option>
              {schemas.map((schema) => (
                <option key={schema.name} value={schema.name}>
                  {schema.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-6px text-11.5px text-fg3 cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
            />
            大文字と小文字を区別
          </label>

          <button
            type="submit"
            disabled={!探せる}
            className="px-12px py-4px rounded-7px bg-fill border-none text-11.5px text-fg cursor-pointer font-inherit disabled:text-fg5 disabled:cursor-default"
          >
            検索
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-x-12px gap-y-4px">
          {SOURCE_KIND_ORDER.map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-5px text-11px text-fg3 cursor-pointer"
            >
              <input type="checkbox" checked={kinds[kind]} onChange={() => toggleKind(kind)} />
              {SOURCE_KIND_LABELS[kind]}
            </label>
          ))}
        </div>

        <PanelBody
          connectionId={connectionId}
          status={status}
          error={error}
          permissionDenied={permissionDenied}
          objects={result?.objects ?? []}
          summary={summarizeSourceResult(result)}
          selected={selected}
          onSelect={select}
        />
      </section>
    </div>
  )
}

interface PanelBodyProps {
  connectionId: string
  status: string
  error: string | null
  permissionDenied: boolean
  objects: SourceObjectMatches[]
  summary: string
  selected: SelectedMatch | null
  onSelect: (connectionId: string, object: SourceObjectMatches, line: number) => Promise<void>
}

/** パネルの本文。権限不足・失敗・検索中・未検索・空・一覧を出し分ける。 */
function PanelBody({
  connectionId,
  status,
  error,
  permissionDenied,
  objects,
  summary,
  selected,
  onSelect,
}: PanelBodyProps) {
  // 権限が無いことを空の結果で表さない。「見えない」と「無い」は別物である。
  if (permissionDenied) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-9px px-24px py-32px">
        <p className="text-13px text-fg m-0">この接続では ALL_SOURCE を参照できません</p>
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
        ソースを検索しています…
      </div>
    )
  }

  if (status === 'idle') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6px py-32px">
        <p className="m-0 text-12.5px text-fg4">
          プロシージャ・ファンクション・パッケージ・トリガー・型の本文から探します
        </p>
        <p className="m-0 text-11px text-fg5">
          ビューの本文は対象外です（ALL_SOURCE に載らないため）
        </p>
      </div>
    )
  }

  if (objects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-32px text-12.5px text-fg4">
        当てはまるソースがありません
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-8px">
      <p className="m-0 text-11px text-fg4">{summary}</p>
      <div className="flex-1 min-h-0 flex gap-12px">
        <div className="flex-1 min-w-0 overflow-auto flex flex-col gap-10px">
          {objects.map((object) => (
            <MatchedObject
              key={`${object.owner}.${object.name}.${object.kind}`}
              object={object}
              selected={selected}
              onSelect={(line) => void onSelect(connectionId, object, line)}
            />
          ))}
        </div>
        {selected ? <ContextPane /> : null}
      </div>
    </div>
  )
}

/** 当たったオブジェクト 1 つと、その中で当たった行。 */
function MatchedObject({
  object,
  selected,
  onSelect,
}: {
  object: SourceObjectMatches
  selected: SelectedMatch | null
  onSelect: (line: number) => void
}) {
  return (
    <div className="flex flex-col gap-2px">
      <p className="m-0 flex items-center gap-6px text-11.5px text-fg2">
        <FileCode2 size={13} className="text-fg5 shrink-0" />
        <span className="font-500">
          {object.owner}.{object.name}
        </span>
        <KindBadge kind={object.kind} />
        <span className="text-fg5">{object.lines.length} 行</span>
      </p>
      <ul className="m-0 pl-0 list-none flex flex-col">
        {object.lines.map((line) => {
          const 選ばれている =
            selected !== null &&
            selected.owner === object.owner &&
            selected.name === object.name &&
            selected.kind === object.kind &&
            selected.line === line.line

          return (
            <li key={line.line} className="m-0">
              <button
                type="button"
                onClick={() => onSelect(line.line)}
                aria-label={`${object.name} の ${line.line} 行目`}
                className={`w-full flex items-baseline gap-8px px-7px py-2px rounded-5px border-none cursor-pointer font-inherit text-left ${
                  選ばれている ? 'bg-fill' : 'bg-transparent'
                }`}
              >
                <span className="shrink-0 w-40px text-right text-10.5px text-fg5">{line.line}</span>
                <span className="flex-1 min-w-0 text-11.5px text-fg2 whitespace-pre truncate">
                  {line.text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * 種別の印。
 *
 * `PACKAGE BODY` と `TYPE BODY` はツリーに出ないため（ADR 0014）、ここで
 * 本体であることが読めないと、仕様と見分けが付かない。
 */
function KindBadge({ kind }: { kind: SourceKind }) {
  return (
    <span className="px-5px py-0.5px rounded-4px bg-fill text-10px text-fg4">
      {SOURCE_KIND_LABELS[kind]}
    </span>
  )
}

/**
 * 選んだ当たり行の前後（ADR 0021）。
 *
 * 全文は読まない。当たった行の周りだけを読むため、数千行のパッケージ本体でも
 * 待ちは一定である。
 */
function ContextPane() {
  const selected = useSourceSearchStore((state) => state.selected)
  const context = useSourceSearchStore((state) => state.context)
  const contextStatus = useSourceSearchStore((state) => state.contextStatus)
  const contextError = useSourceSearchStore((state) => state.contextError)
  const clearSelection = useSourceSearchStore((state) => state.clearSelection)

  if (!selected) {
    return null
  }

  return (
    <section
      aria-label="前後の行"
      className="w-400px shrink-0 min-h-0 overflow-auto rounded-8px bg-fill p-10px flex flex-col gap-7px"
    >
      <div className="flex items-center gap-8px">
        <p className="m-0 flex-1 min-w-0 text-11.5px text-fg2 truncate">
          {selected.owner}.{selected.name} · {selected.line} 行目
        </p>
        <button
          type="button"
          onClick={clearSelection}
          aria-label="前後の行を閉じる"
          className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
        >
          <X size={13} />
        </button>
      </div>

      {contextStatus === 'failed' ? (
        <p className="m-0 text-11.5px text-err break-words">{contextError}</p>
      ) : contextStatus === 'loading' ? (
        <p className="m-0 text-11.5px text-fg4">前後の行を読み込んでいます…</p>
      ) : (
        <ContextLines lines={context} focused={selected.line} />
      )}
    </section>
  )
}

/** 前後の行。当たった行だけ色を変える。 */
function ContextLines({ lines, focused }: { lines: SourceLine[]; focused: number }) {
  if (lines.length === 0) {
    return <p className="m-0 text-11.5px text-fg4">行を読み取れませんでした</p>
  }

  return (
    <ol className="m-0 pl-0 list-none flex flex-col">
      {lines.map((line) => (
        <li key={line.line} className="m-0 flex items-baseline gap-8px">
          <span className="shrink-0 w-32px text-right text-10.5px text-fg5">{line.line}</span>
          <span
            className={`flex-1 min-w-0 text-11.5px whitespace-pre overflow-x-auto ${
              line.line === focused ? 'text-fg font-500' : 'text-fg3'
            }`}
          >
            {line.text}
          </span>
        </li>
      ))}
    </ol>
  )
}
