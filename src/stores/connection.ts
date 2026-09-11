/**
 * 接続の状態を持つストア（ADR 0009）。
 *
 * 1 接続 = 1 ウィンドウであるため、このストアが持つ接続は常に高々 1 つである。
 * Rust 側の呼び出しは `src/api/` 層を介する（ADR 0010）。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { CompletionSettings, ConnectionColor, ConnectionParams } from '../types/db'
import { defaultCompletionSettings, defaultConnectionColor, toErrorMessage } from '../types/db'

/** 接続の段階。ステータスバーの表示に使う。 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed'
  /**
   * サーバ側で接続が切れた（ADR 0026）。
   *
   * `connection` は残したままにする。繋ぎ直すのに接続先とユーザーが要るうえ、
   * 「どこへ繋がっていたか」を見せ続けないと、切れたのがどの接続か分からなく
   * なるためである。**自動では繋ぎ直さない。**繋ぎ直した接続は別のセッションで
   * あり、未コミットの変更はサーバ側で既にロールバックされている。
   */
  | 'lost'

/** 接続中のデータベースの情報。タイトルバーに出す。 */
export interface ActiveConnection {
  /** Rust 側の接続表を引くための識別子。接続のたびに採番する。 */
  id: string
  /**
   * `connections.toml` に保存されている接続の ID。保存していなければ `null`。
   *
   * スキーマフィルタを接続ごとに保存し直すのに使う（ADR 0004・0007）。
   * 実行時の識別子と分けてあるのは、保存しない接続でも繋げるようにするためである。
   */
  savedId: string | null
  /** 利用者が付けた表示名。 */
  name: string
  params: ConnectionParams
  /**
   * 補完の設定（ADR 0013）。接続ごとの項目であり、接続した時点で決まる。
   *
   * `params` と分けてあるのは Rust へ渡さない値だからである。スキーマフィルタと
   * 違って繋いだ後に変わらないため、設定を変える口はこのストアに持たない。
   */
  completion: CompletionSettings
  /**
   * 接続に付けた色（ADR 0015）。保存していない接続では既定の `none`。
   *
   * タイトルバーとステータスバーが「今どこへ繋がっているか」を出すのに使う。
   */
  color: ConnectionColor
  /** 接続が属するグループ名（ADR 0015）。未指定なら `null`。 */
  group: string | null
}

/**
 * 保存済みの接続から引き継ぐ、Rust へ渡さない値（ADR 0013・0015）。
 *
 * `ConnectionParams` と分けてあるのは、どれもデータベースへの繋ぎ方ではなく
 * 画面の見せ方と補完の決まりだからである。
 */
export interface ConnectionProfile {
  /** `connections.toml` に保存されている接続の ID。保存していなければ `null`。 */
  savedId?: string | null
  completion?: CompletionSettings
  color?: ConnectionColor
  group?: string | null
}

interface ConnectionState {
  status: ConnectionStatus
  connection: ActiveConnection | null
  /** 接続に失敗したときのメッセージ。成功すると消える。 */
  error: string | null

  /** 接続する。既に接続していれば先に切断する。 */
  connect: (name: string, params: ConnectionParams, profile?: ConnectionProfile) => Promise<void>
  /** 切断する。接続していなければ何もしない。 */
  disconnect: () => Promise<void>
  /**
   * サーバ側で接続が切れたことを記録する（ADR 0026）。
   *
   * 繋がっている最中にだけ効く。切断したあとに遅れて届いたエラーで、
   * 接続を選ぶ画面を「切れました」に戻さないためである。
   *
   * **段階が実際に変わったかを返す。**印が立った後のプールは往復せずその場で
   * 断を返すため、切れたあとに触るたびに同じ報せが届く。呼び出し側はこの
   * 戻り値を見て、2 度目以降の報せを数えない。
   *
   * @returns この呼び出しで初めて切れた状態になったか
   */
  markLost: (message: string) => boolean
  /**
   * 同じ接続先へ繋ぎ直す（ADR 0026）。
   *
   * 接続の識別子は採番し直す。Rust 側のプールは切れた印を持ったままであり、
   * 使い回すと繋ぎ直しても切れたままに見える。
   *
   * **繋ぎ始めたことを、待つ前に段階へ出す**（ADR 0030）。切れた接続の後片付けは
   * TCP のタイムアウトぶん待たされることがあり、その間「再接続」のボタンが
   * 押せる形で残っていると、押した回数だけプールが増えて迷子になる。
   *
   * 既に繋ぎに行っている最中は何もしない。
   */
  reconnect: () => Promise<void>
}

/**
 * 接続の識別子を採番する。
 *
 * Rust 側の接続表の鍵になる。ウィンドウをまたいでも衝突しない値であればよい。
 */
function createConnectionId(): string {
  return crypto.randomUUID()
}

/**
 * 前の接続を手放す。**終わるのを待たない**（ADR 0030）。
 *
 * Rust 側の `disconnect` は接続表から外してからプールを捨てる。表から外れるのは
 * 呼んだ時点であり、以後その識別子では何も引けない。待たされるのは後片付け
 * （ODPI-C のログオフ）のほうである。
 *
 * **切れている接続のログオフは往復を試みる。**回線が落ちている相手では TCP が
 * 諦めるまで返らず、数十秒かかることがある。それを待ってから繋ぎ直すと、
 * 「再接続」を押しても何十秒も画面が動かない。利用者が待っているのは新しい
 * 接続であって、古い接続の後始末ではない。
 *
 * 失敗も無視する。既に切れている接続は閉じられなくてよく、後片付けの失敗で
 * 次の一手を止めない。
 *
 * @param id 手放す接続の識別子
 */
function 手放す(id: string): void {
  void getDbApi()
    .disconnect(id)
    .catch(() => {
      // 閉じられなくてよい。
    })
}

/**
 * トランザクションを手で終わらせる接続かどうかを返す（ADR 0012）。
 *
 * 読み取り専用の接続と自動コミットの接続には未コミットの状態が生じないため、
 * 未コミットの表示もコミット / ロールバックのボタンも出さない。
 *
 * @param connection 接続中のデータベース。未接続なら `null`
 */
export function isManualCommit(connection: ActiveConnection | null): boolean {
  return connection !== null && !connection.params.readOnly && !connection.params.autoCommit
}

/**
 * データベースへ往復できる状態かを返す（ADR 0026）。
 *
 * 切れている間はコミットもロールバックも届かない。押せば必ず失敗するボタンを
 * 出さないための判定である。
 *
 * @param status 接続の段階
 */
export function canReachDatabase(status: ConnectionStatus): boolean {
  return status === 'connected'
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  connection: null,
  error: null,

  connect: async (name, params, profile = {}) => {
    const {
      savedId = null,
      completion = defaultCompletionSettings,
      color = defaultConnectionColor,
      group = null,
    } = profile
    const previous = get().connection
    const id = createConnectionId()
    set({ status: 'connecting', error: null })

    if (previous) {
      手放す(previous.id)
    }

    try {
      await getDbApi().connect(id, params)
      set({
        status: 'connected',
        connection: { id, savedId, name, params, completion, color, group },
        error: null,
      })
    } catch (error) {
      set({ status: 'failed', connection: null, error: toErrorMessage(error) })
    }
  },

  disconnect: async () => {
    const current = get().connection
    if (!current) {
      return
    }

    // 切断も後片付けを待たない（ADR 0030）。Rust 側の接続表からは呼んだ時点で
    // 外れるため、待たされるのは後片付けだけである。切れている相手ではそれが
    // 数十秒かかることがあり、待つと接続を選ぶ画面へ戻れなくなる。
    set({ status: 'disconnected', connection: null, error: null })
    手放す(current.id)
  },

  markLost: (message) => {
    if (get().status !== 'connected') {
      return false
    }
    set({ status: 'lost', error: message })
    return true
  },

  reconnect: async () => {
    const { connection: current, status } = get()
    if (!current || status === 'connecting') {
      return
    }

    // 押した瞬間に段階を動かす。待ってから動かすと、切れた接続の後片付けに
    // 手間取っている間ボタンが押せるまま残り、押した回数だけプールが増える
    // （ADR 0030）。
    const id = createConnectionId()
    set({ status: 'connecting', error: null })

    手放す(current.id)

    try {
      await getDbApi().connect(id, current.params)
      set({ status: 'connected', connection: { ...current, id }, error: null })
    } catch (error) {
      // 繋ぎ直せなくても接続の情報は捨てない。`connect` と違って「切れている」へ
      // 戻すのは、もう一度押せる状態を残すためである。データベースが起き上がる
      // までの間、押すたびに接続を選び直させてはいけない。
      set({ status: 'lost', connection: current, error: toErrorMessage(error) })
    }
  },
}))
