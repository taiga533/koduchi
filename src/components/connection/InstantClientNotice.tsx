/**
 * Oracle Instant Client の案内画面（ADR 0001）。
 *
 * Instant Client はアプリに同梱していないため、読み込めなかったときは接続を
 * 試す前にこの画面で知らせる。候補が見つかっていれば選ぶだけで済み、無ければ
 * パスを直接入力する。
 *
 * `init()` はプロセスにつき 1 回しか効かないため、指定後は再起動を促す。
 */

import { useState } from 'react'
import { getDbApi } from '../../api/db'
import { toErrorMessage } from '../../types/db'

interface InstantClientNoticeProps {
  /** ODPI-C が返したエラーメッセージ。 */
  message: string
  /** 検出できた候補のディレクトリ。 */
  candidates: string[]
}

export function InstantClientNotice({ message, candidates }: InstantClientNoticeProps) {
  // 候補が 1 つでも見つかっていれば、先頭を初期値として埋めておく。
  const [libDir, setLibDir] = useState(() => candidates[0] ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    try {
      await getDbApi().saveInstantClientLibDir(libDir.trim())
      setSaved(true)
    } catch (caught) {
      setError(toErrorMessage(caught))
    }
  }

  return (
    <div className="w-560px flex flex-col gap-18px">
      <div className="flex flex-col gap-5px">
        <h1 className="text-17px font-600 text-fg tracking--0.01em m-0">
          Oracle Instant Client が見つかりません
        </h1>
        <p className="text-12.5px text-fg3 m-0 leading-[1.6]">
          Oracle への接続には Instant Client が要ります。アプリには同梱していないため、
          別途インストールするか、既にある場所を指定してください。
        </p>
      </div>

      <div className="flex flex-col gap-7px">
        <span className="text-11.5px text-fg3">インストールする</span>
        <pre className="m-0 px-10px py-8px rounded-7px bg-fill text-11.5px text-fg select-text whitespace-pre-wrap">
          brew tap InstantClientTap/instantclient{'\n'}brew install instantclient-basic
        </pre>
      </div>

      <div className="flex flex-col gap-7px">
        <span className="text-11.5px text-fg3">
          ライブラリのディレクトリ（`libclntsh.dylib` のある場所）
        </span>
        <input
          value={libDir}
          onChange={(event) => setLibDir(event.target.value)}
          placeholder="/opt/homebrew/lib"
          className="px-10px py-7px rounded-7px border border-line bg-panel text-12px text-fg font-inherit outline-none focus:border-ac"
        />
        {candidates.length > 0 ? (
          <div className="flex flex-col gap-3px">
            <span className="text-11px text-fg4">見つかった候補</span>
            {candidates.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setLibDir(candidate)}
                className="text-left text-11.5px text-fg2 bg-transparent border-none p-0 cursor-pointer font-inherit underline-offset-3 hover:underline"
              >
                {candidate}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-10px">
        <button
          type="button"
          onClick={() => void save()}
          disabled={libDir.trim() === ''}
          className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit disabled:opacity-50 disabled:cursor-default"
        >
          保存
        </button>
        {saved ? (
          <span className="text-12px text-fg2">
            保存しました。反映するにはアプリを再起動してください。
          </span>
        ) : null}
      </div>

      {error ? <p className="text-12px text-err m-0 break-words">{error}</p> : null}

      <details className="text-11.5px text-fg4">
        <summary className="cursor-pointer">読み込めなかった理由</summary>
        <pre className="m-0 mt-7px whitespace-pre-wrap break-words select-text leading-[1.6]">
          {message}
        </pre>
      </details>
    </div>
  )
}
