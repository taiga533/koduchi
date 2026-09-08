/**
 * 接続の色とデザイントークンの対応（ADR 0015）。
 *
 * 色の値そのものは `tokens.css` の `--cn-*` にしかない（ADR 0008）。ここが
 * 持つのは「どの色がどのトークンを指すか」と「利用者に見せる名前」だけである。
 * 接続の色は接続ごとに動くため UnoCSS のクラス名では書けず、`style` に
 * `var(--cn-red)` を渡す形になる。その参照をこの 1 箇所に閉じ込めてある。
 */

import type { ConnectionColor } from '../types/db'

/** 色を選ぶときに見せる名前。 */
export const CONNECTION_COLOR_LABELS: Record<ConnectionColor, string> = {
  none: 'なし',
  red: '赤',
  orange: '橙',
  yellow: '黄',
  green: '緑',
  blue: '青',
  purple: '紫',
  gray: '灰',
}

/**
 * 接続の色を CSS の値へ直す。
 *
 * 色なしのときは `undefined` を返す。塗る側は色が無ければ何も描かないため、
 * 「色なし」と「まだ色を決めていない」を区別する必要がない。
 *
 * @param color 接続に付けた色
 *
 * @returns `var(--cn-red)` のようなトークンの参照。色なしなら `undefined`
 */
export function connectionColorVar(color: ConnectionColor): string | undefined {
  return color === 'none' ? undefined : `var(--cn-${color})`
}
