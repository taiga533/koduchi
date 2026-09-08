/**
 * タブ 1 枚の幅（ADR 0023 の 34px 帯）。
 *
 * タブが増えても帯からはみ出さないよう、タブは縮む。ただし**いくらでも縮んで
 * よいわけではない**。ADR 0023 が「常に出す」と決めた未保存の `●` 印と閉じる
 * ボタン、ADR 0022 が足した種別のアイコンは、どこまで縮めても見えていなければ
 * ならない。縮む下限はその 3 つと余白の合計より広くなければならず、その関係は
 * 数の問題なので描画抜きで確かめられる。`columnSizing.ts` と同じ考え方で、
 * 内訳と計算だけをここに置く。
 *
 * 下限まで縮めてもなお収まらない枚数になったら、そこから先は帯を横へ
 * スクロールさせる（`tabScroll.ts`）。**名前を削るのはここまで、というのが
 * この下限の意味である。**
 */

/**
 * タブの中で名前以外が占める幅の内訳（px）。
 *
 * `TabBar` の並びと同じ順に書いてある。値は `TabBar` のクラス（`px-11px` /
 * `gap-6px` / `w-7px` / `size={12}` / `gap-5px` / `size={13}`）と対になる。
 * どちらかを変えたらもう一方も変える。
 */
export const TAB_FIXED_PARTS = {
  /** 左の内余白（`px-11px`）。 */
  paddingLeft: 11,
  /** 未保存の `●` 印の場所。印が無いときも空ける（ADR 0023）。 */
  dirtyMark: 7,
  /** 印と名前の間（`gap-6px`）。 */
  gapAfterMark: 6,
  /** 定義タブの種別アイコン（ADR 0022）。 */
  kindIcon: 12,
  /** アイコンと名前の間（`gap-5px`）。 */
  gapAfterIcon: 5,
  /** 名前と閉じるボタンの間（`gap-6px`）。 */
  gapBeforeClose: 6,
  /** 閉じるボタンの `✕`。 */
  closeButton: 13,
  /** 右の内余白（`px-11px`）。 */
  paddingRight: 11,
} as const

/**
 * 名前以外が占める幅の合計（px）を返す。
 *
 * 印とアイコンは同じ側に出るが排他ではない（定義タブは印の場所を空けたうえで
 * アイコンを出す）ため、両方を足した最も広い形で数える。
 */
export function tabFixedWidth(): number {
  return Object.values(TAB_FIXED_PARTS).reduce((total, width) => total + width, 0)
}

/**
 * 縮めきったときに名前へ残す幅（px）。
 *
 * PlemolJP の半角の送り幅は 11.5px で約 6.1px なので、4 文字ぶんにあたる。
 * これより狭めると `…` だけが残り、どのタブなのかが読めなくなる。
 */
export const TAB_NAME_MIN_WIDTH = 25

/** タブがそれ以上縮まない幅（px）。 */
export const TAB_MIN_WIDTH = tabFixedWidth() + TAB_NAME_MIN_WIDTH

/**
 * タブがそれ以上広がらない幅（px）。
 *
 * 長いファイル名 1 枚が帯を占領しないための頭打ちである。超えたぶんの名前は
 * `…` で省き、全体は `title` で確かめられるようにする。
 */
export const TAB_MAX_WIDTH = 180
