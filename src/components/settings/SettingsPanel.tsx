/**
 * 設定画面（ステータスバー右の ⚙︎）。
 *
 * 項目は ADR の「設定画面」節どおり、テーマ 3 択 / エディタの文字の大きさ 4 択 /
 * Oracle Instant Client のパス（未検出時のみ）/ 履歴の一括削除 / 罫線の有無 /
 * 行の高さ の 6 つに限る。
 */

import { useState } from 'react'
import { X } from 'lucide-react'
import type { EditorFontSize, RowHeight, ThemePreference } from '../../theme/appearance'
import { useHistoryStore } from '../../stores/history'
import { useUiStore } from '../../stores/ui'
import { getDbApi } from '../../api/db'

/** テーマの選択肢。 */
const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'システム' },
  { id: 'light', label: 'ライト' },
  { id: 'dark', label: 'ダーク' },
]

/** 行の高さの選択肢。 */
const ROW_HEIGHTS: { id: RowHeight; label: string }[] = [
  { id: 'compact', label: 'つめる' },
  { id: 'comfortable', label: 'ゆったり' },
]

/**
 * エディタの文字の大きさの選択肢。
 *
 * 並びは `theme/appearance.ts` の `EDITOR_FONT_SIZES` と揃える。実際のピクセル値は
 * `theme/tokens.css` の `--fs-editor` にあり、ここには書かない（ADR 0008）。
 */
const EDITOR_FONT_SIZE_OPTIONS: { id: EditorFontSize; label: string }[] = [
  { id: 'small', label: '小' },
  { id: 'medium', label: '標準' },
  { id: 'large', label: '大' },
  { id: 'xlarge', label: '特大' },
]

interface SettingsPanelProps {
  /** Instant Client が未検出か。検出済みならパスの項目を出さない。 */
  clientUnavailable: boolean
  /** 設定画面を閉じる。 */
  onClose: () => void
}

export function SettingsPanel({ clientUnavailable, onClose }: SettingsPanelProps) {
  const appearance = useUiStore((state) => state.appearance)
  const setTheme = useUiStore((state) => state.setTheme)
  const setGridLines = useUiStore((state) => state.setGridLines)
  const setRowHeight = useUiStore((state) => state.setRowHeight)
  const setEditorFontSize = useUiStore((state) => state.setEditorFontSize)
  const clearHistory = useHistoryStore((state) => state.clearAll)

  const [libDir, setLibDir] = useState('')
  const [libDirMessage, setLibDirMessage] = useState<string | null>(null)
  const [historyMessage, setHistoryMessage] = useState<string | null>(null)

  const saveLibDir = async () => {
    try {
      await getDbApi().saveInstantClientLibDir(libDir.trim())
      setLibDirMessage('保存しました。反映にはアプリの再起動が必要です。')
    } catch (error) {
      setLibDirMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px">
      <section className="w-460px max-h-full overflow-auto bg-panel rounded-10px border border-line p-18px flex flex-col gap-16px">
        <div className="flex items-center">
          <h2 className="flex-1 text-14px font-600 text-fg m-0">設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="設定を閉じる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <Row label="テーマ">
          <Segmented
            options={THEMES}
            value={appearance.theme}
            onChange={(theme) => setTheme(theme)}
          />
        </Row>

        <Row label="エディタの文字">
          <Segmented
            options={EDITOR_FONT_SIZE_OPTIONS}
            value={appearance.editorFontSize}
            onChange={(fontSize) => setEditorFontSize(fontSize)}
          />
        </Row>

        <Row label="行の高さ">
          <Segmented
            options={ROW_HEIGHTS}
            value={appearance.rowHeight}
            onChange={(rowHeight) => setRowHeight(rowHeight)}
          />
        </Row>

        <Row label="罫線">
          <label className="flex items-center gap-8px text-12px text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={appearance.gridLines}
              onChange={(event) => setGridLines(event.target.checked)}
            />
            結果テーブルに罫線を引く
          </label>
        </Row>

        {clientUnavailable ? (
          <Row label="Instant Client">
            <div className="flex flex-col gap-6px">
              <div className="flex gap-6px">
                <input
                  value={libDir}
                  onChange={(event) => setLibDir(event.target.value)}
                  placeholder="/opt/oracle/instantclient_23_9"
                  aria-label="Instant Client のディレクトリ"
                  className="flex-1 px-10px py-6px rounded-7px border border-line bg-panel text-12px text-fg font-inherit outline-none focus:border-ac"
                />
                <button
                  type="button"
                  onClick={() => void saveLibDir()}
                  disabled={libDir.trim() === ''}
                  className="px-12px py-6px rounded-7px bg-fill border-none text-12px text-fg cursor-pointer font-inherit disabled:opacity-50"
                >
                  保存
                </button>
              </div>
              {libDirMessage ? <p className="m-0 text-11px text-fg4">{libDirMessage}</p> : null}
            </div>
          </Row>
        ) : null}

        <Row label="履歴">
          <div className="flex flex-col gap-6px">
            <button
              type="button"
              onClick={() => {
                void clearHistory()
                setHistoryMessage('履歴をすべて削除しました。')
              }}
              className="self-start px-12px py-6px rounded-7px bg-fill border-none text-12px text-fg cursor-pointer font-inherit"
            >
              履歴をすべて削除
            </button>
            {historyMessage ? <p className="m-0 text-11px text-fg4">{historyMessage}</p> : null}
          </div>
        </Row>
      </section>
    </div>
  )
}

/** ラベルと中身の 1 行。 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6px">
      <span className="text-11.5px text-fg3">{label}</span>
      {children}
    </div>
  )
}

/** 少数の選択肢からの切替。デザインのセグメントコントロールに合わせる。 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2px p-2px rounded-8px bg-line2 self-start">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={option.id === value}
          className={`px-12px py-4px rounded-6px text-12px border-none cursor-pointer font-inherit ${
            option.id === value ? 'bg-panel text-fg' : 'bg-transparent text-fg3'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
