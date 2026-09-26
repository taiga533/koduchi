/**
 * Instant Client の判定が終わるまでの表示。
 *
 * 判定の前に接続の画面を出すと、読めない Instant Client のまま接続を試させて
 * 意味の分からないエラーで落とすことになる（ADR 0001）。判定が済むまではこれだけを出す。
 */
export function Splash() {
  return (
    <div className="h-full flex items-center justify-center bg-bg text-12.5px text-fg4">
      起動しています…
    </div>
  )
}
