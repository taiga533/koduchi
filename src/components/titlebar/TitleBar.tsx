/**
 * タイトルバー（ADR 0009）。
 *
 * macOS の信号機はネイティブのものを残し、`trafficLightPosition` で位置だけを
 * ずらしている。ここではその分だけ左端を空け、42px の帯に接続名・検索ボックス・
 * Ask AI ボタンを並べる。
 *
 * 検索ボックスと Ask AI は器のみで、操作はできない（ADR の機能スコープ）。
 */

import { Search, Sparkles } from 'lucide-react'
import { useConnectionStore } from '../../stores/connection'
import { TITLE_BAR_HEIGHT, titleBarContentLeft } from './geometry'

export function TitleBar() {
  const connection = useConnectionStore((state) => state.connection)
  const status = useConnectionStore((state) => state.status)

  return (
    <header
      data-tauri-drag-region
      className="flex items-center gap-14px pr-14px bg-bg shrink-0"
      style={{ height: TITLE_BAR_HEIGHT, paddingLeft: titleBarContentLeft() }}
    >
      <div data-tauri-drag-region className="flex items-center gap-9px">
        <div className="w-13px h-13px rounded-4px bg-ac" />
        {connection ? (
          <div className="flex items-center gap-7px">
            <span
              className="w-6px h-6px rounded-full"
              style={{
                background: status === 'connected' ? 'oklch(0.58 0.12 152)' : 'var(--fg5)',
              }}
            />
            <span className="text-13px font-600 text-fg tracking--0.01em">{connection.name}</span>
            <span className="text-12.5px text-fg4">{connection.params.username}</span>
          </div>
        ) : (
          <span className="text-13px font-600 text-fg">koduchi</span>
        )}
      </div>

      <div data-tauri-drag-region className="flex-1 flex justify-center items-center">
        <div className="flex items-center gap-9px w-400px px-10px py-4px rounded-7px bg-panel border border-line">
          <Search size={14} className="text-fg5 shrink-0" />
          <span className="flex-1 text-12px text-fg4">
            {connection ? 'テーブル・クエリ・コマンドを検索' : '接続すると検索できます'}
          </span>
          {connection ? <span className="text-10.5px text-fg5">⌘K</span> : null}
        </div>
      </div>

      <div className="flex items-center gap-8px px-11px py-5px rounded-7px bg-panel border border-line">
        <Sparkles size={14} className="text-fg5" />
        <span className="text-12px text-fg4">Ask AI</span>
      </div>
    </header>
  )
}
