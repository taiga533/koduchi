/**
 * 接続を作成する画面（デザイン 5g）。
 *
 * ダイアログではなく画面内に置く。「名前」の下に接続方式のセグメント
 * （EZConnect / TNS）を 1 行加えてある（ADR 0006）。TNS を選ぶと、ホスト /
 * ポート / サービス名の 3 欄がエイリアスのプルダウン 1 欄に差し替わる。
 *
 * 保存済みの接続を選ぶのは手前の `ConnectionPicker` の役目である。ここは
 * `initial` を受け取ったときだけ編集画面として振る舞い、欄を埋めた状態で開く。
 * パスワードはキーチェーンから取り出す（ADR 0004）。起動時の自動再接続は
 * 行わない。
 *
 * デザインにある「SSH トンネルを使う」と「設定ファイルから読み込む」は
 * 対象外のため置かない（ADR 0004、機能スコープ）。
 *
 * 色とグループ（ADR 0015）もここで決める。色は決め打ちのパレットから選ぶ形で
 * あり、カラーピッカーは置かない。グループは自由入力だが、既に使われている名前を
 * 入力候補として出し、同じ意味のグループが綴り違いで割れないようにしてある。
 */

import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getDbApi } from '../../api/db'
import { useConnectionStore } from '../../stores/connection'
import { connectionColorVar, CONNECTION_COLOR_LABELS } from '../../theme/connectionColors'
import type {
  ConnectionColor,
  ConnectionParams,
  IdentifierCase,
  SavedConnection,
  SchemaFilter,
  TnsEntry,
} from '../../types/db'
import {
  CONNECTION_COLORS,
  defaultCompletionSettings,
  defaultConnectionColor,
  defaultSchemaFilter,
  toErrorMessage,
} from '../../types/db'
import { collectGroupNames, normalizeGroup } from './grouping'
import { blockComposingSubmit } from '../../input/ime'

/** Oracle の既定のリスナーポート。 */
const DEFAULT_PORT = '1521'

/** 接続方式。 */
type Method = 'ezConnect' | 'tns'

/**
 * 補完で挿入する識別子の綴りの選択肢（ADR 0013）。
 *
 * Oracle のカタログは名前を大文字で持つため、「大文字」と「カタログのまま」は
 * 同じ結果になる。3 つに分けてあるのは、名前を小文字で持つ PostgreSQL を
 * 足したときに意味が分かれるためである。
 */
const IDENTIFIER_CASES: { value: IdentifierCase; label: string; example: string }[] = [
  { value: 'preserve', label: 'カタログのまま', example: 'ORDERS' },
  { value: 'lower', label: '小文字', example: 'orders' },
  { value: 'upper', label: '大文字', example: 'ORDERS' },
]

export interface ConnectionFormProps {
  /** 編集する保存済みの接続。`null` なら新規作成として開く。 */
  initial?: SavedConnection | null
  /** 接続に成功したときに呼ぶ。スキーマの読み込みなどの後始末に使う。 */
  onConnected?: (connectionId: string, filter: SchemaFilter) => void
  /** 選ぶ画面へ戻るときに呼ぶ。渡さなければ戻るボタンを出さない。 */
  onBack?: () => void
}

export function ConnectionForm({ initial = null, onConnected, onBack }: ConnectionFormProps = {}) {
  const connect = useConnectionStore((state) => state.connect)
  const status = useConnectionStore((state) => state.status)
  const error = useConnectionStore((state) => state.error)

  const ez = initial?.target.method === 'ezConnect' ? initial.target : null
  const tns = initial?.target.method === 'tns' ? initial.target : null

  const [id] = useState<string>(() => initial?.id ?? crypto.randomUUID())
  const [name, setName] = useState(initial?.name ?? '')
  const [method, setMethod] = useState<Method>(tns ? 'tns' : 'ezConnect')
  const [host, setHost] = useState(ez?.host ?? 'localhost')
  const [port, setPort] = useState(ez ? String(ez.port) : DEFAULT_PORT)
  const [serviceName, setServiceName] = useState(ez?.serviceName ?? '')
  const [directory, setDirectory] = useState(tns?.directory ?? '')
  const [alias, setAlias] = useState(tns?.alias ?? '')
  const [entries, setEntries] = useState<TnsEntry[]>([])
  const [tnsWarnings, setTnsWarnings] = useState<string[]>([])
  const [tnsError, setTnsError] = useState<string | null>(null)
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false)
  const [color, setColor] = useState<ConnectionColor>(initial?.color ?? defaultConnectionColor)
  const [group, setGroup] = useState(initial?.group ?? '')
  /** 既に使われているグループ名。入力候補に出す。 */
  const [knownGroups, setKnownGroups] = useState<string[]>([])
  // 既定は手動コミット。Oracle クライアントの慣習に合わせ、誤爆したときに
  // 取り返せるほうを既定にしてある（ADR 0012）。
  const [autoCommit, setAutoCommit] = useState(initial?.autoCommit ?? false)
  const [remember, setRemember] = useState(true)
  const [filter] = useState<SchemaFilter>(initial?.schemaFilter ?? defaultSchemaFilter)
  const [identifierCase, setIdentifierCase] = useState<IdentifierCase>(
    initial?.completion.identifierCase ?? defaultCompletionSettings.identifierCase,
  )
  const [testing, setTesting] = useState(false)
  /** 直近のテスト接続の結果。試した内容の写しを添えてある。 */
  const [tested, setTested] = useState<TestResult | null>(null)

  /**
   * tnsnames.ora を読み、エイリアスのプルダウンを作る。
   *
   * 状態の更新をすべて `then` の中へ置いてあるのは、編集で開いたときに効果から
   * 呼ぶためである。効果の中で同期的に状態を更新すると描画が連鎖する。
   */
  const readTnsnames = useCallback(
    (dir: string) =>
      getDbApi()
        .readTnsnames(dir)
        .then((file) => {
          setTnsError(null)
          setEntries(file.entries)
          setTnsWarnings(file.warnings)
          setAlias((current) =>
            file.entries.some((entry) => entry.aliases.includes(current))
              ? current
              : (file.entries[0]?.aliases[0] ?? ''),
          )
        })
        .catch((readError: unknown) => {
          setEntries([])
          setTnsWarnings([])
          setTnsError(toErrorMessage(readError))
        }),
    [],
  )

  // グループの入力候補は、保存済みの接続に既に付いている名前から作る。
  useEffect(() => {
    void getDbApi()
      .listSavedConnections()
      .then((list) => setKnownGroups(collectGroupNames(list)))
      .catch(() => {})
  }, [])

  // 編集で開いたときは、保存してあるパスワードとエイリアスの一覧を取りにいく。
  useEffect(() => {
    if (!initial) {
      return
    }

    void getDbApi()
      .loadConnectionPassword(initial.id)
      .then((stored) => setPassword(stored ?? ''))
      .catch(() => {})

    if (initial.target.method === 'tns') {
      void readTnsnames(initial.target.directory)
    }
  }, [initial, readTnsnames])

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
  // テストは名前を要さない。繋がるかどうかに名前は関わらないためである。
  const canTest = targetReady && username.trim() !== '' && !testing && !connecting

  /** 今の入力から接続情報を組み立てる。 */
  const buildParams = (): ConnectionParams => ({
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
        : {
            method: 'descriptor',
            descriptor: entries.find((entry) => entry.aliases.includes(alias))?.descriptor ?? '',
          },
    readOnly,
    autoCommit,
  })

  /**
   * 繋がるかどうかだけを試す。
   *
   * 接続は残らないため、試した後もこの画面に留まる。結果には試した内容の写しを
   * 添えておき、入力が変わった時点で古い結果を隠す。
   */
  const test = async () => {
    if (!canTest) {
      return
    }

    const params = buildParams()
    setTesting(true)
    try {
      const version = await getDbApi().testConnection(params)
      setTested({ params, ok: true, message: `接続できました · Oracle Database ${version}` })
    } catch (testError) {
      setTested({ params, ok: false, message: toErrorMessage(testError) })
    } finally {
      setTesting(false)
    }
  }

  // 試した後に入力が変わっていれば、その結果はもう当てにならないため隠す。
  const testResult =
    tested && JSON.stringify(tested.params) === JSON.stringify(buildParams()) ? tested : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    const 整えたグループ = normalizeGroup(group)

    await connect(name.trim(), buildParams(), {
      savedId: remember ? id : null,
      completion: { identifierCase },
      color,
      group: 整えたグループ,
    })

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
            autoCommit,
            color,
            group: 整えたグループ,
            schemaFilter: filter,
            completion: { identifierCase },
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
    <form
      onKeyDown={blockComposingSubmit}
      onSubmit={(event) => void submit(event)}
      className="w-520px flex flex-col gap-18px"
    >
      <div className="flex flex-col gap-5px">
        <h1 className="text-17px font-600 text-fg tracking--0.01em m-0">
          {initial ? '接続を編集' : '接続を作成'}
        </h1>
        <p className="text-12.5px text-fg3 m-0">1つの接続が1つのウィンドウになります</p>
      </div>

      <div className="grid grid-cols-2 gap-x-14px gap-y-12px">
        <Field label="名前">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="prod-replica"
            className={inputClass}
          />
        </Field>
        <Field label="グループ">
          <input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            list="connection-groups"
            placeholder="本番"
            className={inputClass}
          />
          <datalist id="connection-groups">
            {knownGroups.map((known) => (
              <option key={known} value={known} />
            ))}
          </datalist>
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
        {/* 読み取り専用のときは書き込みが起きないため、自動コミットは意味を持たない */}
        <label
          className={`flex items-center gap-8px text-12.5px cursor-pointer ${
            readOnly ? 'text-fg5 cursor-default' : 'text-fg'
          }`}
        >
          <input
            type="checkbox"
            checked={autoCommit && !readOnly}
            disabled={readOnly}
            onChange={(event) => setAutoCommit(event.target.checked)}
          />
          実行のたびに自動でコミットする
        </label>
        <div className="flex items-center gap-10px">
          <span className="text-11.5px text-fg3">色</span>
          <div className="flex gap-4px">
            {CONNECTION_COLORS.map((choice) => (
              <ColorButton
                key={choice}
                color={choice}
                active={color === choice}
                onClick={() => setColor(choice)}
              />
            ))}
          </div>
          <span className="text-11.5px text-fg4">{CONNECTION_COLOR_LABELS[color]}</span>
        </div>
        <div className="flex items-center gap-10px">
          <span className="text-11.5px text-fg3">補完の綴り</span>
          <div className="flex gap-2px p-2px rounded-8px bg-line2">
            {IDENTIFIER_CASES.map((choice) => (
              <MethodButton
                key={choice.value}
                active={identifierCase === choice.value}
                onClick={() => setIdentifierCase(choice.value)}
              >
                {choice.label}
              </MethodButton>
            ))}
          </div>
          <span className="text-11.5px text-fg4 font-mono">
            {IDENTIFIER_CASES.find((choice) => choice.value === identifierCase)?.example}
          </span>
        </div>
        <label className="flex items-center gap-8px text-12.5px text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          この接続を保存する（パスワードはキーチェーンへ）
        </label>
      </div>

      {testResult ? (
        <p className={`text-12px m-0 break-words ${testResult.ok ? 'text-ac' : 'text-err'}`}>
          {testResult.message}
        </p>
      ) : null}

      <div className="flex items-center gap-10px">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="px-12px py-6px rounded-7px bg-fill border-none text-12.5px text-fg cursor-pointer font-inherit"
          >
            戻る
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void test()}
          disabled={!canTest}
          className="px-12px py-6px rounded-7px bg-fill border-none text-12.5px text-fg cursor-pointer font-inherit disabled:opacity-50 disabled:cursor-default"
        >
          {testing ? '試しています…' : 'テスト接続'}
        </button>
        <span className="flex-1" />
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit disabled:opacity-50 disabled:cursor-default"
        >
          {connecting ? '接続中…' : remember ? '保存して接続' : '接続'}
        </button>
      </div>

      {error ? (
        <p className="text-12px text-err m-0 pt-4px border-t border-line2 break-words">{error}</p>
      ) : null}
    </form>
  )
}

/** テスト接続の結果。試した接続情報を添え、入力が変わったら隠すのに使う。 */
interface TestResult {
  params: ConnectionParams
  ok: boolean
  message: string
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
 * 色を選ぶ 1 つ分の見本（ADR 0015）。
 *
 * 決め打ちのパレットから選ばせるため、押せる先は色の数だけである。色なしは
 * 塗らずに罫線だけの升で表す。選んでいるものはアクセントの縁で示す。色そのもので
 * 選択を示すと、色の違いと選択の有無が同じ手掛かりで重なって読めなくなる。
 *
 * @param color 見本が表す色
 * @param active 今選ばれているか
 * @param onClick 押したときに呼ぶ
 */
function ColorButton({
  color,
  active,
  onClick,
}: {
  color: ConnectionColor
  active: boolean
  onClick: () => void
}) {
  const value = connectionColorVar(color)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`色: ${CONNECTION_COLOR_LABELS[color]}`}
      title={CONNECTION_COLOR_LABELS[color]}
      className={`w-16px h-16px rounded-5px cursor-pointer p-0 ${
        active ? 'border-2 border-solid border-ac' : 'border border-solid border-line'
      }`}
      style={{ background: value ?? 'var(--panel)' }}
    />
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
