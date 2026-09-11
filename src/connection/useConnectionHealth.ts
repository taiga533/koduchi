/**
 * 接続の様子を定期的に覗く（ADR 0030）。
 *
 * **データベースへは往復しない。**覗くのは OCI がクライアント側に持っている
 * 状態だけであり、問い合わせは 1 つも投げない。ADR 0026 が却下したのは
 * 「`select 1 from dual` を定期的に投げる」案であり、その理由は**その問い合わせ
 * 自体がアイドル時間をリセットしてしまう**ことだった。ここはパケットを 1 つも
 * 送らないため、その理由に触れない。サーバ側が設定した `IDLE_TIME` は
 * これまでどおり効く。
 *
 * 分かるのは 2 つである。
 *
 * 1. サーバ側から TCP を閉じられていないか（データベースの停止、セッションの
 *    強制終了）。分かったらその場で断として配る。**問い合わせを走らせる前に
 *    ステータスバーが変わる。**
 * 2. 最後にデータベースと往復できたのはいつか。回線が落ちただけの断は 1 で
 *    見えないため、こちらを添えて「どこまでが確かか」を正直に見せる。
 *
 * 繋がっているときだけ動く。切れた後・繋ぐ前は覗く相手が無い。
 */

import { useEffect, useState } from 'react'
import { getDbApi } from '../api/db'
import { useConnectionStore } from '../stores/connection'
import { PROBE_LOST_MESSAGE, reportConnectionLost } from './lost'

/**
 * 覗く間隔（ミリ秒）。
 *
 * 表示は分の単位であるため 30 秒あれば足りる。往復しない覗きであり、
 * データベース側には何も起きない。
 */
export const HEALTH_POLL_INTERVAL_MS = 30_000

/** 覗いて分かったこと。 */
export interface ConnectionFreshness {
  /** 最後にデータベースと往復できた時刻（UNIX ミリ秒）。 */
  lastRoundTripMs: number
  /** 覗いた時刻（UNIX ミリ秒）。経過を出すときの「今」である。 */
  checkedAtMs: number
}

/** 覗いた結果と、それがどの接続のものか。 */
interface 覗いた結果 extends ConnectionFreshness {
  /** この結果を得た接続の識別子。 */
  connectionId: string
}

/**
 * 接続の様子を覗き続け、分かったことを返す。
 *
 * 繋がっていないときと、まだ 1 度も覗けていないときは `null` を返す。
 *
 * 断が分かったときは `reportConnectionLost` へ配る。受け手は例外の経路
 * （`watchConnection`）と同じ `App.tsx` の見張りであり、**2 度目以降を数えない
 * のもそちらの仕事である**（ADR 0026）。
 */
export function useConnectionHealth(): ConnectionFreshness | null {
  const status = useConnectionStore((state) => state.status)
  const connectionId = useConnectionStore((state) => state.connection?.id ?? null)
  const [freshness, setFreshness] = useState<覗いた結果 | null>(null)

  useEffect(() => {
    if (status !== 'connected' || connectionId === null) {
      return
    }

    // 覗き終わる前に接続が変わったら、その答えは古い接続のものである。
    let 有効 = true
    // 前の覗きが終わらないうちに次を始めない。実行中の接続では OCI 側の
    // 待ちが入りうるため、重ねると待ちだけが積み上がる。
    let 覗いている = false

    const 覗く = async () => {
      if (覗いている) {
        return
      }
      覗いている = true

      try {
        const health = await getDbApi().connectionHealth(connectionId)
        if (!有効) {
          return
        }

        setFreshness({
          connectionId,
          lastRoundTripMs: health.lastRoundTripMs,
          checkedAtMs: Date.now(),
        })

        if (health.disconnected) {
          reportConnectionLost(PROBE_LOST_MESSAGE)
        }
      } catch {
        // 覗けなかったことは利用者へ出さない。断そのものは往復の経路
        // （`watchConnection`）が拾う。ここで出すと、切断の直後に届いた
        // 「その接続はもう無い」までが画面へ漏れる。
      } finally {
        覗いている = false
      }
    }

    void 覗く()
    const timer = window.setInterval(() => void 覗く(), HEALTH_POLL_INTERVAL_MS)

    return () => {
      有効 = false
      window.clearInterval(timer)
    }
  }, [connectionId, status])

  // 繋がっていないときと、別の接続で覗いた結果しか持っていないときは何も返さない。
  // 段階と識別子から描画のたびに決めるため、覗いていない状態を作るための
  // 後始末が要らない。**前の接続の「最終応答」を新しい接続の顔で出さない。**
  if (status !== 'connected' || freshness?.connectionId !== connectionId) {
    return null
  }

  return freshness
}
