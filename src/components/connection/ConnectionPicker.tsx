/**
 * 保存した接続を選ぶ画面。
 *
 * 未接続のときに最初に出る画面であり、接続を作成する画面（`ConnectionForm`）の
 * 手前に立つ。保存済みの接続を押すとその場で繋ぐ。パスワードはキーチェーンから
 * 取り出し、入っていなければその行に入力欄を出す（ADR 0004）。
 *
 * TNS の接続は保存時にエイリアスしか持たないため、繋ぐ直前に tnsnames.ora を
 * 読み直して接続記述子へ解決する（ADR 0006）。エイリアスが消えていれば繋がず、
 * その旨を出す。
 *
 * 削除はキーチェーンのエントリごと消える取り消せない操作であるため、行の中で
 * 1 度確認を取る。ダイアログを開かないのは、画面の外へ意識を飛ばさないためと、
 * テストから素直に辿れるようにするためである。
 */

import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { getDbApi } from '../../api/db'
import { useConnectionStore } from '../../stores/connection'
import type { ConnectTarget, SavedConnection, SavedTarget, SchemaFilter } from '../../types/db'
import { toErrorMessage } from '../../types/db'

interface ConnectionPickerProps {
  /** 「新しい接続」を押したときに呼ぶ。 */
  onCreate: () => void
  /** 保存済みの接続を編集するときに呼ぶ。 */
  onEdit: (connection: SavedConnection) => void
  /** 接続に成功したときに呼ぶ。スキーマの読み込みなどの後始末に使う。 */
  onConnected?: (connectionId: string, filter: SchemaFilter) => void
}

export function ConnectionPicker({ onCreate, onEdit, onConnected }: ConnectionPickerProps) {
  const connect = useConnectionStore((state) => state.connect)
  const storeError = useConnectionStore((state) => state.error)

  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [loaded, setLoaded] = useState(false)
  /** パスワードの入力を待っている接続。 */
  const [asking, setAsking] = useState<SavedConnection | null>(null)
  const [password, setPassword] = useState('')
  /** 削除の確認を出している接続の ID。 */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** 接続の処理中である接続の ID。 */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getDbApi()
      .listSavedConnections()
      .then(setSaved)
      .catch(() => setSaved([]))
      .finally(() => setLoaded(true))
  }, [])

  /** 保存済みの接続 1 件へ繋ぐ。 */
  const run = async (connection: SavedConnection, secret: string) => {
    setBusy(connection.id)
    setError(null)
    try {
      const target = await resolveTarget(connection.target)
      await connect(
        connection.name,
        {
          username: connection.username,
          password: secret,
          target,
          readOnly: connection.readOnly,
          autoCommit: connection.autoCommit,
        },
        connection.id,
        connection.completion,
      )

      const active = useConnectionStore.getState().connection
      if (active) {
        setAsking(null)
        setPassword('')
        onConnected?.(active.id, connection.schemaFilter)
      }
    } catch (resolveError) {
      setError(toErrorMessage(resolveError))
    } finally {
      setBusy(null)
    }
  }

  /** 行を押したときの入口。パスワードが無ければ先に尋ねる。 */
  const start = async (connection: SavedConnection) => {
    setConfirming(null)
    setError(null)
    setBusy(connection.id)

    const stored = await getDbApi()
      .loadConnectionPassword(connection.id)
      .catch(() => null)
    setBusy(null)

    if (stored === null) {
      setAsking(connection)
      setPassword('')
      return
    }
    await run(connection, stored)
  }

  /** 保存済みの接続を消す。キーチェーンのエントリも消える。 */
  const remove = async (connectionId: string) => {
    setConfirming(null)
    if (asking?.id === connectionId) {
      setAsking(null)
    }
    await getDbApi().deleteConnection(connectionId)
    setSaved((current) => current.filter((connection) => connection.id !== connectionId))
  }

  const message = error ?? storeError

  return (
    <div className="w-520px flex flex-col gap-18px">
      <div className="flex flex-col gap-5px">
        <h1 className="text-17px font-600 text-fg tracking--0.01em m-0">接続を選ぶ</h1>
        <p className="text-12.5px text-fg3 m-0">1つの接続が1つのウィンドウになります</p>
      </div>

      {!loaded ? null : saved.length === 0 ? (
        <p className="text-12.5px text-fg4 m-0">保存された接続はまだありません</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-4px">
          {saved.map((connection) => (
            <li key={connection.id} className="flex flex-col gap-4px">
              <div className="flex items-center gap-8px">
                <button
                  type="button"
                  onClick={() => void start(connection)}
                  disabled={busy !== null}
                  className="flex-1 min-w-0 flex items-baseline gap-9px px-10px py-7px rounded-7px bg-fill border-none cursor-pointer font-inherit text-left disabled:cursor-default"
                >
                  <span className="text-12px text-fg shrink-0">{connection.name}</span>
                  <span className="text-11px text-fg4 truncate">{describeTarget(connection)}</span>
                  <span className="flex-1" />
                  <span className="text-11px text-fg5 shrink-0">
                    {busy === connection.id ? '接続中…' : connection.username}
                  </span>
                </button>
                <IconButton label={`${connection.name} を編集`} onClick={() => onEdit(connection)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  label={`${connection.name} を削除`}
                  onClick={() => setConfirming(connection.id)}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>

              {confirming === connection.id ? (
                <div className="flex items-center gap-8px pl-10px">
                  <span className="text-11.5px text-fg3">
                    保存したパスワードごと消えます。削除しますか？
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(connection.id)}
                    className="px-10px py-3px rounded-6px bg-fill text-err text-11.5px font-600 border-none cursor-pointer font-inherit"
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="px-10px py-3px rounded-6px bg-fill text-fg text-11.5px border-none cursor-pointer font-inherit"
                  >
                    やめる
                  </button>
                </div>
              ) : null}

              {asking?.id === connection.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(connection, password)
                  }}
                  className="flex items-center gap-6px pl-10px"
                >
                  <label className="flex-1 flex items-center gap-8px">
                    <span className="text-11.5px text-fg3">パスワード</span>
                    <input
                      type="password"
                      autoFocus
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="flex-1 px-10px py-5px rounded-7px border border-line bg-panel text-12px text-fg font-inherit outline-none focus:border-ac"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="px-12px py-5px rounded-7px bg-ac text-acfg text-11.5px font-600 border-none cursor-pointer font-inherit disabled:opacity-50 disabled:cursor-default"
                  >
                    接続
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {message ? (
        <p className="text-12px text-err m-0 pt-4px border-t border-line2 break-words">{message}</p>
      ) : null}

      <div className="flex items-center gap-10px">
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-6px px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit"
        >
          <Plus size={14} />
          新しい接続
        </button>
      </div>
    </div>
  )
}

/**
 * 保存した接続先を、繋ぐのに使える形へ直す。
 *
 * TNS は保存時にエイリアスしか持たない。tnsnames.ora は書き換わりうるため、
 * 繋ぐ直前に読み直す（ADR 0006）。
 *
 * @param target 保存されている接続先
 *
 * @returns 接続に渡せる接続先
 */
async function resolveTarget(target: SavedTarget): Promise<ConnectTarget> {
  if (target.method === 'ezConnect') {
    return {
      method: 'ezConnect',
      host: target.host,
      port: target.port,
      serviceName: target.serviceName,
    }
  }

  const file = await getDbApi().readTnsnames(target.directory)
  const entry = file.entries.find((candidate) => candidate.aliases.includes(target.alias))
  if (!entry) {
    throw new Error(`tnsnames.ora に ${target.alias} が見つかりません`)
  }
  return { method: 'descriptor', descriptor: entry.descriptor }
}

/**
 * 保存済みの接続の接続先を 1 行で表す。
 *
 * @param connection 保存された接続
 */
function describeTarget(connection: SavedConnection): string {
  return connection.target.method === 'ezConnect'
    ? `${connection.target.host}:${connection.target.port}/${connection.target.serviceName}`
    : `TNS ${connection.target.alias}`
}

/** 行の右端に置く、記号だけのボタン。 */
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center bg-transparent border-none p-0 text-fg5 cursor-pointer font-inherit hover:text-fg3"
    >
      {children}
    </button>
  )
}
