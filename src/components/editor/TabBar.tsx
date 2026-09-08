/**
 * エディタタブの並び（デザイン 3a の 34px 帯）。
 *
 * 未保存のタブには `●` 印を出す（ADR 0005）。
 *
 * 並ぶのは SQL タブと定義タブの 2 種類である（ADR 0022）。定義タブは編集
 * できないため `●` 印を持たず、代わりに種類の分かるアイコンを名前の左へ添える。
 */

import { Plus, TableProperties, X } from 'lucide-react'
import { useTabStore } from '../../stores/tab'
import { isDirty, isDefinitionTab } from '../../stores/tabKinds'

interface TabBarProps {
  /**
   * タブを閉じる。
   *
   * 開いたままの結果セットを手放す必要があるため（ADR 0003）、ストアを直接
   * 触らずに呼び出し側へ委ねる。
   */
  onCloseTab: (id: string) => void
}

export function TabBar({ onCloseTab }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const selectTab = useTabStore((state) => state.selectTab)
  const openNewTab = useTabStore((state) => state.openNewTab)

  return (
    <div className="h-34px flex items-stretch gap-4px bg-bg shrink-0">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`flex items-center gap-8px px-11px rounded-7px text-11.5px ${
              active ? 'bg-panel text-fg' : 'text-fg3'
            }`}
          >
            <button
              type="button"
              onClick={() => selectTab(tab.id)}
              aria-label={isDefinitionTab(tab) ? `${tab.name} の定義` : undefined}
              className="flex items-center gap-5px bg-transparent border-none p-0 text-inherit font-inherit text-11.5px cursor-pointer"
            >
              {isDefinitionTab(tab) ? (
                <TableProperties size={12} className="text-fg5 shrink-0" aria-hidden />
              ) : null}
              {tab.name}
            </button>
            {isDirty(tab) ? (
              <span
                className="w-7px h-7px rounded-full bg-ac shrink-0"
                aria-label="未保存"
                role="img"
              />
            ) : (
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`${tab.name} を閉じる`}
                className="flex items-center bg-transparent border-none p-0 text-fg5 font-inherit cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={openNewTab}
        aria-label="新しいタブ"
        className="flex items-center px-9px text-fg5 bg-transparent border-none cursor-pointer font-inherit"
      >
        <Plus size={15} />
      </button>
      <div className="flex-1" />
    </div>
  )
}
