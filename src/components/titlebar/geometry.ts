/**
 * macOS の信号機（ウィンドウ操作ボタン）の配置（ADR 0009）。
 *
 * Tauri の `trafficLightPosition` は、見た目上のオフセットをそのまま指定する
 * ものではない。tao の `inset_traffic_lights`
 * （`tao/src/platform_impl/macos/view.rs`）は次の手順を踏む。
 *
 * 1. タイトルバーのコンテナの高さを `ボタンの高さ + y` に変える
 * 2. コンテナの上端をウィンドウの上端に合わせる
 * 3. ボタンの `origin.x` だけを書き換える。`origin.y` は触らない
 *
 * macOS の座標系は左下が原点であるため、`origin.y` を据え置いたままコンテナの
 * 高さを変えると、ボタンはウィンドウ上端に対して相対的に動く。
 *
 * ```
 * ボタン上端 = コンテナの高さ − (origin.y + ボタンの高さ)
 *            = (ボタンの高さ + y) − (origin.y + ボタンの高さ)
 *            = y − origin.y
 * ```
 *
 * `origin.y` と各寸法は macOS 26 上で `NSWindow.standardWindowButton` を直接
 * 読んで実測した（`titlebarAppearsTransparent` + `fullSizeContentView` の構成、
 * つまり Tauri の `titleBarStyle: "Overlay"` と同じ状態）。コンテナの高さを
 * 変えても `origin.y` が 9 のまま動かないことも、tao と同じ手順を再現して
 * 確認してある。
 */

/** 信号機 1 つの直径（実測値）。 */
export const TRAFFIC_LIGHT_DIAMETER = 14

/** 信号機どうしの中心間隔（実測値）。 */
export const TRAFFIC_LIGHT_SPACING = 23

/** 既定の状態でのボタンの `origin.y`（実測値）。 */
const TRAFFIC_LIGHT_ORIGIN_Y = 9

/**
 * ボタンの中心とウィンドウ上端の距離が `y` からどれだけずれるか。
 *
 * `中心 = 上端 + 直径/2 = (y − origin.y) + 直径/2 = y − 2`
 */
const CENTER_OFFSET = TRAFFIC_LIGHT_ORIGIN_Y - TRAFFIC_LIGHT_DIAMETER / 2

/** タイトルバーの高さ。デザイン 3a の 42px 帯。 */
export const TITLE_BAR_HEIGHT = 42

/** 信号機の左端。`tauri.conf.json` の `trafficLightPosition.x` と揃える。 */
export const TRAFFIC_LIGHT_LEFT = 14

/** 信号機とヘッダーの内容のあいだに空ける余白。 */
const CONTENT_GAP = 4

/**
 * 信号機をタイトルバーの縦中央に置くための `trafficLightPosition.y` を求める。
 *
 * @param titleBarHeight タイトルバーの高さ
 *
 * @returns `tauri.conf.json` に書く `y` の値
 */
export function trafficLightY(titleBarHeight: number): number {
  return titleBarHeight / 2 + CENTER_OFFSET
}

/**
 * 信号機の右端を求める。
 *
 * 3 つのボタンが `TRAFFIC_LIGHT_SPACING` おきに並ぶ。
 *
 * @param left 信号機の左端（`trafficLightPosition.x`）
 */
export function trafficLightRight(left: number): number {
  return left + TRAFFIC_LIGHT_SPACING * 2 + TRAFFIC_LIGHT_DIAMETER
}

/**
 * ヘッダーの内容を始めてよい左端を求める。
 *
 * 信号機はネイティブのまま重ねて描かれるため、その右端より内側から描き始める。
 *
 * @param left 信号機の左端
 */
export function titleBarContentLeft(left: number = TRAFFIC_LIGHT_LEFT): number {
  return trafficLightRight(left) + CONTENT_GAP
}
