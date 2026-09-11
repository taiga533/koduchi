/**
 * 「いつまで確かだったか」の言い方（ADR 0030）。
 *
 * 小槌は往復したときにしか断に気付けない（ADR 0026）。往復を起こさない覗き
 * （`Prober`）はサーバ側から切られた断を拾うが、**回線そのものが落ちた断は
 * 見えない。**その差を黙って飲み込むと、ステータスバーは「接続中」の緑を
 * 出し続けることになり、利用者は確かめられていない事実を確かめられたものと
 * 読む。
 *
 * そこで、最後にデータベースと往復できた時刻が古くなったら、そのことを添える。
 * 「接続中」を取り下げはしない（切れたと分かったわけではない）。**言えるのは
 * 「ここまでは確かだった」だけであり、それをそのまま言う。**
 *
 * ここは純粋な関数だけを持つ。時計は呼び出し側から渡す。
 */

/**
 * 「接続中」とだけ言い切ってよい猶予（ミリ秒）。
 *
 * これを過ぎたら最後の往復からの経過を添える。5 分にしてあるのは、実務の
 * Oracle の `IDLE_TIME` が 15〜60 分であること（ADR 0026）に対して、切られる
 * 前に気付ける余地を残しつつ、少し目を離しただけで注記が出てこない幅として
 * である。
 */
export const FRESH_WINDOW_MS = 5 * 60 * 1000

/** 1 分のミリ秒。 */
const MINUTE_MS = 60 * 1000

/** 1 時間のミリ秒。 */
const HOUR_MS = 60 * MINUTE_MS

/** 1 日のミリ秒。 */
const DAY_MS = 24 * HOUR_MS

/**
 * 経過時間を日本語の相対表現にする。
 *
 * 切り捨てる。「12 分前」は 12 分以上 13 分未満を指す。繰り上げると、まだ
 * 経っていない時間を経ったことにしてしまう。
 *
 * @param elapsedMs 経過時間（ミリ秒）。負の値は 0 として扱う
 */
export function formatElapsed(elapsedMs: number): string {
  const 経過 = Math.max(0, elapsedMs)

  if (経過 < MINUTE_MS) {
    return '1 分未満前'
  }
  if (経過 < HOUR_MS) {
    return `${Math.floor(経過 / MINUTE_MS)} 分前`
  }
  if (経過 < DAY_MS) {
    return `${Math.floor(経過 / HOUR_MS)} 時間前`
  }
  return `${Math.floor(経過 / DAY_MS)} 日前`
}

/** ステータスバーへ添える、往復の古さについての一言。 */
export interface Staleness {
  /** ステータスバーに並べる短い文言。 */
  label: string
  /** 何を意味するかを添える説明。`title` に出す。 */
  title: string
}

/**
 * 最後に往復できた時刻から、添える一言を決める（ADR 0030）。
 *
 * 猶予の内に収まっていれば `null` を返す。**何も言わないのが正しい場合に
 * 何かを言うと、注記そのものが読まれなくなる。**
 *
 * 時計が巻き戻っていた場合（`lastRoundTripMs` が未来）も `null` を返す。
 * 起きていないことを告げない。
 *
 * @param lastRoundTripMs 最後にデータベースと往復できた時刻（UNIX ミリ秒）
 * @param nowMs 現在時刻（UNIX ミリ秒）
 */
export function describeStaleness(lastRoundTripMs: number, nowMs: number): Staleness | null {
  const 経過 = nowMs - lastRoundTripMs

  if (経過 < FRESH_WINDOW_MS) {
    return null
  }

  const 相対 = formatElapsed(経過)
  return {
    label: `最終応答 ${相対}`,
    title: `データベースと最後にやり取りできたのは${相対}です。小槌は問い合わせたときにしか接続の生死を確かめません（余分な問い合わせはサーバ側のアイドル時間の設定を骨抜きにするためです）。`,
  }
}
