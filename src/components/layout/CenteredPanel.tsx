/**
 * 本体いっぱいに広がる 1 枚のパネル。案内画面と接続作成に使う。
 */

import type { ReactNode } from 'react'

export function CenteredPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-w-0 bg-panel rounded-10px border border-line flex items-center justify-center overflow-auto p-24px">
      {children}
    </div>
  )
}
