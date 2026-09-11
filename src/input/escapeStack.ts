/**
 * 重なったオーバーレイのうち、`esc` を受け取る 1 つを決める積み（ADR 0031）。
 *
 * オーバーレイは焦点を持っているとは限らない。背景の暗幕を押した直後のように
 * `document.activeElement` が `<body>` に戻っている状態でも `esc` で閉じられ
 * なければならないため、打鍵を受けるのは器ではなく `window` である
 * （`useEscapeKey.ts`）。
 *
 * ただし `window` で受けると、開いているオーバーレイ全部に同じ 1 打鍵が届いて
 * しまう。セルの詳細パネルの上にコマンドパレットが開いているとき、`esc` 1 回で
 * 両方が消えるのは「1 つ戻る」ではない。**だから受け手を積みにして、いちばん
 * 後に開いたものだけを走らせる。**
 *
 * この module は DOM を触らない。打鍵を拾う側は `useEscapeKey.ts` にある。
 */

/** `esc` を受け取る候補 1 つ。 */
export type EscapeHandler = () => void

/** 開いた順に積む。末尾がいちばん手前のオーバーレイである。 */
const handlers: EscapeHandler[] = []

/**
 * `esc` の受け手を積み、外すための関数を返す。
 *
 * 同じ関数を 2 度積んだときは、外すのも後に積んだほうからである
 * （`lastIndexOf` で末尾側を探す）。
 *
 * @param handler 自分がいちばん手前のときに走らせたい処理
 *
 * @returns 積みから外す関数。二度呼んでも隣の受け手を巻き添えにしない
 */
export function pushEscapeHandler(handler: EscapeHandler): () => void {
  handlers.push(handler)
  let 外した = false
  return () => {
    if (外した) {
      return
    }
    外した = true
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }
}

/**
 * いちばん手前の受け手を 1 つだけ走らせる。
 *
 * @returns 走らせたかどうか。偽なら `esc` は誰も使っていない
 */
export function dispatchEscape(): boolean {
  const handler = handlers[handlers.length - 1]
  if (handler === undefined) {
    return false
  }
  handler()
  return true
}

/** 積まれている受け手の数。テストのために公開する。 */
export function escapeHandlerCount(): number {
  return handlers.length
}
