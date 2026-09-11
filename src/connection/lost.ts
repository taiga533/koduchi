/**
 * 接続断の見分けと報せ（ADR 0026）。
 *
 * サーバ側で接続が切れたことは、**どの往復でも**起こりうる。実行だけでなく、
 * スキーマ取得・テーブル定義・セッション一覧・ソース検索・実行計画・コミットの
 * どれでも同じ番号が返る。そのため気付く場所を経路ごとに書き足す形にはせず、
 * `src/api/` 層の窓口を丸ごと包んで 1 箇所で見張る。足した経路だけが断に
 * 気付けない、という抜けを構造として作らないためである。
 *
 * 報せの受け手を決めるのはここではない。`App.tsx` が `onConnectionLost` で
 * 受け取り、`connection` ストアと `execution` ストアへ順に配る。切断の後片付けを
 * `App.tsx` が順に呼ぶ（ADR README「接続の切断と切り替え」）のと同じ形であり、
 * ストア同士を結合させない。
 *
 * **繋ぎ直しは自動で行わない**（ADR 0026）。切れた時点で Oracle は未コミットの
 * 変更をロールバックしており、繋ぎ直した接続は別のセッションである。黙って
 * 繋ぎ直すと、利用者が「まだコミットしていない変更がある」と思っている状態と
 * サーバ側の実際が食い違う。ここが担うのは「切れた」を届けるところまでである。
 */

import { isDbError, toErrorMessage } from '../types/db'

/**
 * 接続が切れたときにステータスバーへ出す文言。
 *
 * データベースが返した原文はメッセージタブへ残す。ステータスバーは狭いため、
 * ここでは状態だけを言う。
 */
export const CONNECTION_LOST_LABEL = '接続が切れました'

/**
 * 値がサーバ側の接続断を表すエラーかどうかを返す。
 *
 * @param value 捕捉した例外
 */
export function isConnectionLost(value: unknown): boolean {
  return isDbError(value) && value.kind === 'connectionLost'
}

/** 接続断を受け取る側。データベースが返した原文が渡る。 */
type Listener = (message: string) => void

/** 登録されている受け手。ウィンドウに 1 つの接続しか無いため集合で足りる。 */
const listeners = new Set<Listener>()

/**
 * 接続断を見張る。
 *
 * @param listener 断のときに呼ぶ処理
 * @returns 呼ぶと見張りを外す関数
 */
export function onConnectionLost(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 往復を起こさずに覗いて断が分かったときの文言（ADR 0030）。
 *
 * データベースからエラーが返ってきたわけではないため、原文が無い。何が起きて
 * いるかをこちらの言葉で言う。
 */
export const PROBE_LOST_MESSAGE = 'サーバ側から接続が切られています'

/**
 * 接続が切れたことを見張りへ報せる（ADR 0030）。
 *
 * 例外を経由しない経路のための入口である。往復を起こさない覗き（ADR 0030）で
 * 断が分かったときは、拒まれた約束が無いため `noteConnectionLost` を通せない。
 *
 * **報せを数えないのは受け手の仕事である。**ここは届いた事実をそのまま配り、
 * 2 度目かどうかは `connection` ストアの段階が決める（ADR 0026）。
 *
 * @param message 断の内容
 */
export function reportConnectionLost(message: string): void {
  for (const listener of listeners) {
    listener(message)
  }
}

/**
 * 例外が接続断であれば見張りへ報せる。
 *
 * 例外そのものは握り潰さない。断であることは呼び出し元にとってもエラーであり、
 * メッセージタブや結果ペインへ出す必要がある。
 *
 * @param value 捕捉した例外
 * @returns 接続断として報せたか
 */
export function noteConnectionLost(value: unknown): boolean {
  if (!isConnectionLost(value)) {
    return false
  }

  reportConnectionLost(toErrorMessage(value))
  return true
}

/**
 * 窓口の呼び出しをすべて見張る包み（ADR 0026）。
 *
 * 関数の項目を 1 つずつ包み直し、拒まれた約束を `noteConnectionLost` へ通す。
 * 項目を数え上げる形にしてあるのは、窓口にメソッドを足したときに包み忘れが
 * 起きないようにするためである。関数でない項目はそのまま持ち越す。
 *
 * テストから差し替えた窓口も同じように包まれる。断の経路を、実装の差し替え
 * （ADR 0010）だけで端から端まで試せる。
 *
 * @param api 包む窓口
 */
export function watchConnection<T extends object>(api: T): T {
  const watched: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(api)) {
    if (typeof value !== 'function') {
      watched[name] = value
      continue
    }

    const call = value as (...args: unknown[]) => unknown
    watched[name] = async (...args: unknown[]) => {
      try {
        return await call.apply(api, args)
      } catch (error) {
        noteConnectionLost(error)
        throw error
      }
    }
  }

  return watched as T
}
