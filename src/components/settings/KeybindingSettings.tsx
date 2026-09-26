/**
 * 設定画面のキー割り当て（ADR 0037）。
 *
 * コマンドの表の行ごとに今のキーを出し、押して次の 1 打鍵を記録する。記録と
 * 断りの判定は `keybindings/bindings.ts` の純粋な関数が持ち、ここは見せ方と
 * 打鍵の受け取りだけを受け持つ。表（仲介者の値）は呼び出し側から受け取る。
 */

import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { RotateCcw, X } from 'lucide-react'
import type { BindableCommand, KeybindingIssue } from '../../keybindings/bindings'
import {
  FIXED_KEYS,
  checkRecordedChord,
  withOverride,
  withoutOverride,
} from '../../keybindings/bindings'
import { chordFromPress, formatChord } from '../../keybindings/chord'
import { useKeybindings } from '../../keybindings/context'
import { isComposingKey } from '../../input/ime'
import { useUiStore } from '../../stores/ui'

interface KeybindingSettingsProps {
  /** 割り当て直せる操作。コマンドの表の行である。 */
  commands: readonly BindableCommand[]
}

/** 記録の欄の下に出す断り。 */
interface Refusal {
  id: string
  message: string
}

/**
 * 食い違いを 1 行の文言にする。
 *
 * @param issue 食い違い
 * @param commands 相手の名前を引く表
 */
function issueMessage(issue: KeybindingIssue, commands: readonly BindableCommand[]): string {
  switch (issue.kind) {
    case 'unreadable':
      return `設定の「${issue.text}」が読めないため、既定のキーで動いています`
    case 'shadowed': {
      const owner = commands.find((command) => command.id === issue.by)
      return `${formatChord(issue.chord)} は「${owner?.label ?? issue.by}」と重なっているため効きません`
    }
    case 'fixed':
      return `${formatChord(issue.chord)} は「${issue.by}」で使われているため効きません`
  }
}

export function KeybindingSettings({ commands }: KeybindingSettingsProps) {
  const resolved = useKeybindings()
  const overrides = useUiStore((state) => state.keybindings)
  const setKeybindings = useUiStore((state) => state.setKeybindings)

  const [recording, setRecording] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  /** 記録をやめる。断りも一緒に消す。 */
  const stopRecording = () => {
    setRecording(null)
    setRefusal(null)
  }

  /**
   * 記録中の打鍵を受ける。
   *
   * **先頭で変換中かを見る**（ADR 0025）。変換確定の `⏎` を組み合わせとして
   * 記録してはならない。受けた打鍵は既定の動作を止める。ウィンドウの振り分けと
   * `useEscapeKey` は `defaultPrevented` を見て飛ばすため、記録中の `⌘W` でタブは
   * 閉じず、`esc` で設定画面ごと閉じることもない（ADR 0031 の順序のまま）。
   *
   * @param command 記録している操作
   * @param event 打鍵
   */
  const onRecordKeyDown = (command: BindableCommand, event: ReactKeyboardEvent) => {
    if (recording !== command.id || isComposingKey(event)) {
      return
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    // 修飾の無い `⇥` は焦点を次へ送る。記録の欄から出られなくならないようにする。
    if (plain && event.key === 'Tab') {
      return
    }
    event.preventDefault()
    if (plain && event.key === 'Escape') {
      stopRecording()
      return
    }

    const chord = chordFromPress(event)
    if (chord === null) {
      return
    }
    const check = checkRecordedChord(chord, command.id, commands, resolved)
    if (!check.ok) {
      setRefusal({ id: command.id, message: check.reason })
      return
    }
    setKeybindings(withOverride(overrides, command, chord))
    stopRecording()
  }

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <div className="flex flex-col gap-8px">
      <ul className="m-0 p-0 list-none flex flex-col gap-4px">
        {commands.map((command) => {
          const chord = resolved.chords.get(command.id)
          const overridden = Object.hasOwn(overrides, command.id)
          const isRecording = recording === command.id
          const issues = resolved.issues.filter((issue) => issue.id === command.id)
          return (
            <li key={command.id} className="flex flex-col gap-2px">
              <div className="flex items-center gap-6px">
                <span className="flex-1 min-w-0 text-12px text-fg truncate">{command.label}</span>
                <button
                  type="button"
                  aria-label={`${command.label}のキー`}
                  aria-pressed={isRecording}
                  onClick={() => (isRecording ? stopRecording() : setRecording(command.id))}
                  onKeyDown={(event) => onRecordKeyDown(command, event)}
                  onBlur={() => {
                    if (isRecording) {
                      stopRecording()
                    }
                  }}
                  className={`w-120px px-8px py-3px rounded-6px border text-11.5px text-left cursor-pointer font-inherit ${
                    isRecording ? 'border-ac bg-panel text-fg' : 'border-line bg-fill text-fg2'
                  }`}
                >
                  {isRecording ? 'キーを押す…' : chord ? formatChord(chord) : '—'}
                </button>
                <button
                  type="button"
                  aria-label={`${command.label}を既定に戻す`}
                  title="既定に戻す"
                  disabled={!overridden}
                  onClick={() => setKeybindings(withoutOverride(overrides, command.id))}
                  className="flex items-center bg-transparent border-none p-2px text-fg4 cursor-pointer font-inherit disabled:invisible"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`${command.label}のキーを外す`}
                  title="キーを外す"
                  disabled={!chord}
                  onClick={() => setKeybindings(withOverride(overrides, command, null))}
                  className="flex items-center bg-transparent border-none p-2px text-fg4 cursor-pointer font-inherit disabled:invisible"
                >
                  <X size={12} />
                </button>
              </div>
              {refusal?.id === command.id ? (
                <p role="alert" className="m-0 text-11px text-err">
                  {refusal.message}
                </p>
              ) : null}
              {issues.map((issue) => (
                <p key={issue.kind} className="m-0 text-11px text-warn">
                  {issueMessage(issue, commands)}
                </p>
              ))}
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        disabled={!hasOverrides}
        onClick={() => {
          stopRecording()
          setKeybindings({})
        }}
        className="self-start px-12px py-6px rounded-7px bg-fill border-none text-12px text-fg cursor-pointer font-inherit disabled:opacity-50"
      >
        すべて既定に戻す
      </button>

      <details className="text-11.5px text-fg3">
        <summary className="cursor-pointer">変えられないキー</summary>
        <ul className="m-0 mt-6px p-0 list-none flex flex-col gap-2px">
          {FIXED_KEYS.map((fixed) => (
            <li key={fixed.label} className="flex gap-8px">
              <span className="w-80px text-fg2">{formatChord(fixed.chord)}</span>
              <span>{fixed.label}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
