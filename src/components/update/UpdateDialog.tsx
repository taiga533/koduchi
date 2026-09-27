/**
 * 自動アップデートのダイアログ（ADR 0042）。
 *
 * `update` ストアの段階をそのまま描く。書き換えるのは `update` ストアだけなので、
 * 仲介者を通さずストアの action を直に呼ぶ。閉じてよいかの判定もストアが持つ
 * （取得と再起動の最中は `dismiss` が断る）。
 *
 * 接続の有無に関わらず出るため、`App.tsx` は 3 つの画面のどれにもこれを置く。
 */

import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { getUpdaterApi } from '../../api/updater'
import { useEscapeKey } from '../../input/useEscapeKey'
import { useUpdateStore } from '../../stores/update'
import { ErrorCopyButton } from '../results/ErrorCopyButton'
import { formatProgress, progressRatio } from './progress'

/** ダイアログ。ストアが閉じていれば何も描かない。 */
export function UpdateDialog() {
  const dialogOpen = useUpdateStore((state) => state.dialogOpen)
  return dialogOpen ? <OpenUpdateDialog /> : null
}

/** 開いているダイアログ。`esc` の受け手は開いている間だけ積む（ADR 0031）。 */
function OpenUpdateDialog() {
  const status = useUpdateStore((state) => state.status)
  const update = useUpdateStore((state) => state.update)
  const progress = useUpdateStore((state) => state.progress)
  const error = useUpdateStore((state) => state.error)
  const dismiss = useUpdateStore((state) => state.dismiss)
  const install = useUpdateStore((state) => state.install)
  const restart = useUpdateStore((state) => state.restart)

  useEscapeKey(dismiss)

  const openReleaseNotes = () => {
    if (update) {
      void getUpdaterApi().openReleaseNotes(update.version)
    }
  }

  switch (status) {
    case 'idle':
    case 'checking':
      return (
        <Frame icon={<RefreshCw size={15} className="text-fg4" />} title="アップデートを確認">
          <Body>新しい版を確かめています…</Body>
          <Actions>
            <SecondaryButton onClick={dismiss}>閉じる</SecondaryButton>
          </Actions>
        </Frame>
      )
    case 'upToDate':
      return (
        <Frame icon={<CircleCheck size={15} className="text-fg4" />} title="最新の版です">
          <Body>お使いの小槌は最新の版です。</Body>
          <Actions>
            <SecondaryButton onClick={dismiss}>閉じる</SecondaryButton>
          </Actions>
        </Frame>
      )
    case 'available':
      return (
        <Frame icon={<Download size={15} className="text-fg4" />} title="新しい版があります">
          <Body>
            小槌 {update?.version} を使えます（今は {update?.currentVersion}）。
            ダウンロードすると、すべてのウィンドウを閉じてから新しい版で起ち上げ直します。
            未コミットの変更があれば、閉じる前に尋ねます。
          </Body>
          <Actions>
            <LinkButton onClick={openReleaseNotes}>リリースノート</LinkButton>
            <SecondaryButton onClick={dismiss}>あとで</SecondaryButton>
            <PrimaryButton onClick={() => void install()}>ダウンロードして再起動</PrimaryButton>
          </Actions>
        </Frame>
      )
    case 'downloading': {
      const ratio = progress ? progressRatio(progress) : null
      return (
        <Frame icon={<Download size={15} className="text-fg4" />} title="ダウンロードしています">
          <div
            role="progressbar"
            aria-label="ダウンロードの進み具合"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
            className="h-6px rounded-3px bg-fill overflow-hidden"
          >
            {/* 割合が分からないときは帯を満たさない。進んでいることは下の量で示す。 */}
            <div
              className="h-full bg-ac"
              style={{ width: ratio === null ? '0%' : `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <Body>{progress ? formatProgress(progress) : ''}</Body>
        </Frame>
      )
    }
    case 'restarting':
      return (
        <Frame icon={<RefreshCw size={15} className="text-fg4" />} title="再起動しています">
          <Body>すべてのウィンドウを閉じています…</Body>
        </Frame>
      )
    case 'installed':
      return (
        <Frame icon={<CircleCheck size={15} className="text-fg4" />} title="新しい版を入れました">
          <Body>
            再起動すると小槌 {update?.version}{' '}
            になります。今は再起動せずに続けても、次に起動したときから新しい版になります。
          </Body>
          <Actions>
            <SecondaryButton onClick={dismiss}>あとで</SecondaryButton>
            <PrimaryButton onClick={() => void restart()}>再起動</PrimaryButton>
          </Actions>
        </Frame>
      )
    case 'failed':
      return (
        <Frame
          icon={<CircleAlert size={15} className="text-fg4" />}
          title="アップデートに失敗しました"
        >
          <p className="text-12px text-err leading-[1.6] m-0 break-words">{error}</p>
          {error ? <ErrorCopyButton text={error} /> : null}
          <Actions>
            <SecondaryButton onClick={dismiss}>閉じる</SecondaryButton>
          </Actions>
        </Frame>
      )
  }
}

/** ダイアログの器。暗幕と枠と見出し。 */
function Frame({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px"
    >
      <section className="w-400px bg-panel rounded-10px border border-line p-18px flex flex-col gap-13px">
        <h2 className="flex items-center gap-8px text-14px font-600 text-fg m-0">
          {icon}
          {title}
        </h2>
        {children}
      </section>
    </div>
  )
}

/** 本文。 */
function Body({ children }: { children: ReactNode }) {
  return <p className="text-12px text-fg2 leading-[1.6] m-0">{children}</p>
}

/** 押しどころの並び。 */
function Actions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-8px">{children}</div>
}

/** 主の押しどころ。 */
function PrimaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-12px py-6px rounded-7px bg-ac border-none text-11.5px text-acfg cursor-pointer font-inherit"
    >
      {children}
    </button>
  )
}

/** 従の押しどころ。 */
function SecondaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-12px py-6px rounded-7px bg-fill border-none text-11.5px text-fg cursor-pointer font-inherit"
    >
      {children}
    </button>
  )
}

/** ブラウザで開く押しどころ。並びの左端へ寄せる。 */
function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mr-auto flex items-center gap-4px px-0 py-6px bg-transparent border-none text-11.5px text-fg3 cursor-pointer font-inherit"
    >
      <ExternalLink size={12} />
      {children}
    </button>
  )
}
