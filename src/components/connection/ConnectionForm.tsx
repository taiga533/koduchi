/**
 * 接続を作成する画面（デザイン 5g）。
 *
 * ダイアログではなく画面内に置く。「名前」の下に接続方式のセグメント
 * （EZConnect / TNS）を 1 行加えてある（ADR 0006）。TNS を選ぶと、ホスト /
 * ポート / サービス名の 3 欄がエイリアスのプルダウン 1 欄に差し替わる。
 *
 * 保存済みの接続は一覧から選ぶと欄が埋まる。パスワードはキーチェーンから
 * 取り出す（ADR 0004）。起動時の自動再接続は行わない。
 *
 * デザインにある「SSH トンネルを使う」と「設定ファイルから読み込む」は
 * 対象外のため置かない（ADR 0004、機能スコープ）。
 */

import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { X } from 'lucide-react'
import { getDbApi } from '../../api/db'
import { useConnectionStore } from '../../stores/connection'
import type { SavedConnection, SchemaFilter, TnsEntry } from '../../types/db'
import { defaultSchemaFilter, toErrorMessage } from '../../types/db'

/** Oracle の既定のリスナーポート。 */
const DEFAULT_PORT = '1521'

/** 接続方式。 */
type Method = 'ezConnect' | 'tns'

interface ConnectionFormProps {
  /** 接続に成功したときに呼ぶ。スキーマの読み込みなどの後始末に使う。 */
  onConnected?: (connectionId: string, filter: SchemaFilter) => void
}

export function ConnectionForm({ onConnected }: ConnectionFormProps = {}) {
  const connect = useConnectionStore((state) => state.connect)
  const status = useConnectionStore((state) => state.status)
  const error = useConnectionStore((state) => state.error)

  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [id, setId] = useState<string>(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [method, setMethod] = useState<Method>('ezConnect')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [serviceName, setServiceName] = useState('')
  const [directory, setDirectory] = useState('')
  const [alias, setAlias] = useState('')
  const [entries, setEntries] = useState<TnsEntry[]>([])
  const [tnsWarnings, setTnsWarnings] = useState<string[]>([])
  const [tnsError, setTnsError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [remember, setRemember] = useState(true)
  const [filter, setFilter] = useState<SchemaFilter>(defaultSchemaFilter)

  useEffect(() => {
    void getDbApi()
      .listSavedConnections()
      .then(setSaved)
      .catch(() => setSaved([]))
  }, [])

  /** tnsnames.ora を読み、エイリアスのプルダウンを作る。 */
  const readTnsnames = useCallback(async (dir: string) => {
    setTnsError(null)
    try {
      const file = await getDbApi().readTnsnames(dir)
      setEntries(file.entries)
      setTnsWarnings(file.warnings)
      setAlias((current) =>
        file.entries.some((entry) => entry.aliases.includes(current))
          ? current
          : (file.entries[0]?.aliases[0] ?? ''),
      )
    } catch (readError) {
      setEntries([])
      setTnsWarnings([])
      setTnsError(toErrorMessage(readError))
    }
  }, [])

  /** 保存済みの接続を欄へ流し込む。 */
  const load = async (connection: SavedConnection) => {
    setId(connection.id)
    setName(connection.name)
    setUsername(connection.username)
    setReadOnly(connection.readOnly)
    setFilter(connection.schemaFilter)
    setRemember(true)

    if (connection.target.method === 'ezConnect') {
      setMethod('ezConnect')
      setHost(connection.target.host)
      setPort(String(connection.target.port))
      setServiceName(connection.target.serviceName)
    } else {
      setMethod('tns')
      setDirectory(connection.target.directory)
      setAlias(connection.target.alias)
      await readTnsnames(connection.target.directory)
      setAlias(connection.target.alias)
    }

    const stored = await getDbApi()
      .loadConnectionPassword(connection.id)
      .catch(() => null)
    setPassword(stored ?? '')
  }

  /** 保存済みの接続を消す。キーチェーンのエントリも消える。 */
  const remove = async (connectionId: string) => {
    await getDbApi().deleteConnection(connectionId)
    setSaved((current) => current.filter((connection) => connection.id !== connectionId))
  }

  const chooseDirectory = async () => {
    const chosen = await openDialog({ directory: true, title: 'tnsnames.ora のある場所' })
    if (typeof chosen === 'string') {
      setDirectory(chosen)
      await readTnsnames(chosen)
    }
  }

  const connecting = status === 'connecting'
  const targetReady =
    method === 'ezConnect'
      ? host.trim() !== '' && serviceName.trim() !== ''
      : entries.some((entry) => entry.aliases.includes(alias))
  const canSubmit = name.trim() !== '' && targetReady && username.trim() !== '' && !connecting

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    const descriptor = entries.find((entry) => entry.aliases.includes(alias))?.descriptor ?? ''

    await connect(
      name.trim(),
      {
        username: username.trim(),
        password,
        target:
          method === 'ezConnect'
            ? {
                method: 'ezConnect',
                host: host.trim(),
                port: Number(port) || Number(DEFAULT_PORT),
                serviceName: serviceName.trim(),
              }
            : { method: 'descriptor', descriptor },
        readOnly,
      },
      remember ? id : null,
    )

    const connection = useConnectionStore.getState().connection
    if (!connection) {
      return
    }

    if (remember) {
      await getDbApi()
        .saveConnection(
          {
            id,
            name: name.trim(),
            username: username.trim(),
            readOnly,
            schemaFilter: filter,
            target:
              method === 'ezConnect'
                ? {
                    method: 'ezConnect',
                    host: host.trim(),
                    port: Number(port) || Number(DEFAULT_PORT),
                    serviceName: serviceName.trim(),
                  }
                : { method: 'tns', directory, alias },
          },
          password === '' ? null : password,
        )
        .catch(() => {})
    }

    onConnected?.(connection.id, filter)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="w-520px flex flex-col gap-18px">
      <div className="flex flex-col gap-5px">
        <h1 className="text-17px font-600 text-fg tracking--0.01em m-0">接続を作成</h1>
        <p className="text-12.5px text-fg3 m-0">1つの接続が1つのウィンドウになります</p>
      </div>

      {saved.length > 0 ? (
        <ul className="list-none m-0 p-0 flex flex-col gap-4px">
          {saved.map((connection) => (
            <li key={connection.id} className="flex items-center gap-8px">
              <button
                type="button"
                onClick={() => void load(connection)}
                className="flex-1 flex items-center gap-9px px-10px py-6px rounded-7px bg-fill border-none cursor-pointer font-inherit text-left"
              >
                <span className="text-12px text-fg">{connection.name}</span>
                <span className="text-11px text-fg4">{describeTarget(connection)}</span>
              </button>
              <button
                type="button"
                onClick={() => void remove(connection.id)}
                aria-label={`${connection.name} を削除`}
                className="flex items-center bg-transparent border-none p-0 text-fg5 cursor-pointer font-inherit"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-x-14px gap-y-12px">
        <Field label="名前" span={2}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="prod-replica"
            className={inputClass}
          />
        </Field>

        <div className="col-span-2 flex items-center gap-10px">
          <span className="text-11.5px text-fg3">方式</span>
          <div className="flex gap-2px p-2px rounded-8px bg-line2">
            <MethodButton active={method === 'ezConnect'} onClick={() => setMethod('ezConnect')}>
              EZConnect
            </MethodButton>
            <MethodButton active={method === 'tns'} onClick={() => setMethod('tns')}>
              TNS
            </MethodButton>
          </div>
        </div>

        {method === 'ezConnect' ? (
          <>
            <Field label="ホスト">
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="ポート">
              <input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
            <Field label="サービス名" span={2}>
              <input
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                placeholder="FREEPDB1"
                className={inputClass}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="tnsnames.ora の場所" span={2}>
              <div className="flex gap-6px">
                <input
                  value={directory}
                  onChange={(event) => setDirectory(event.target.value)}
                  onBlur={() => directory.trim() !== '' && void readTnsnames(directory.trim())}
                  placeholder="/opt/oracle/network/admin"
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={() => void chooseDirectory()}
                  className="px-12px py-6px rounded-7px bg-fill border-none text-12px text-fg cursor-pointer font-inherit"
                >
                  選ぶ
                </button>
              </div>
            </Field>
            <Field label="エイリアス" span={2}>
              <select
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                disabled={entries.length === 0}
                className={inputClass}
              >
                {entries.length === 0 ? <option value="">（読み込まれていません）</option> : null}
                {entries.map((entry) => (
                  <option key={entry.aliases[0]} value={entry.aliases[0]}>
                    {entry.aliases.join(', ')}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label="ユーザー">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="パスワード">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {tnsError ? <p className="text-12px text-err m-0">{tnsError}</p> : null}
      {tnsWarnings.length > 0 ? (
        <div className="flex flex-col gap-3px">
          <p className="text-12px text-fg3 m-0">一部のエントリを読み込めませんでした</p>
          {tnsWarnings.map((warning) => (
            <p key={warning} className="text-11px text-fg4 m-0">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-8px">
        <label className="flex items-center gap-8px text-12.5px text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          読み取り専用で接続する
        </label>
        <label className="flex items-center gap-8px text-12.5px text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          この接続を保存する（パスワードはキーチェーンへ）
        </label>
      </div>

      <div className="flex items-center gap-10px">
        <span className="flex-1" />
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit disabled:opacity-50 disabled:cursor-default"
        >
          {connecting ? '接続中…' : '接続'}
        </button>
      </div>

      {error ? (
        <p className="text-12px text-err m-0 pt-4px border-t border-line2 break-words">{error}</p>
      ) : null}
    </form>
  )
}

/** 保存済みの接続の接続先を 1 行で表す。 */
function describeTarget(connection: SavedConnection): string {
  return connection.target.method === 'ezConnect'
    ? `${connection.target.host}:${connection.target.port}/${connection.target.serviceName}`
    : `TNS ${connection.target.alias}`
}

/** 入力欄の見た目。デザインの角丸 7px・1px 罫線に合わせる。 */
const inputClass =
  'px-10px py-7px rounded-7px border border-line bg-panel text-12px text-fg font-inherit outline-none focus:border-ac'

/** 接続方式のセグメントのボタン。 */
function MethodButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-12px py-3px rounded-6px text-12px border-none cursor-pointer font-inherit ${
        active ? 'bg-panel text-fg' : 'bg-transparent text-fg3'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * ラベルと入力欄の組。
 *
 * `label` 要素で包むことで、入力欄がラベルの文言で引けるようになる。
 */
function Field({
  label,
  span,
  children,
}: {
  label: string
  span?: number
  children: React.ReactNode
}) {
  return (
    <label
      className="flex flex-col gap-5px"
      style={span === 2 ? { gridColumn: 'span 2' } : undefined}
    >
      <span className="text-11.5px text-fg3">{label}</span>
      {children}
    </label>
  )
}
