import type { ReactNode } from 'react'

/**
 * 本体いっぱいに広がる 1 枚のパネル。案内画面と接続作成に使う。
 *
 * 繋がる前の画面はサイドバーも結果ペインも持たない。3 パネルの枠（`Shell`）は
 * そのまま使い、中身を 1 枚に揃えることで、繋いだ後と見た目の縁が変わらない。
 */
export function CenteredPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-w-0 bg-panel rounded-10px border border-line flex items-center justify-center overflow-auto p-24px">
      {children}
    </div>
  )
}
