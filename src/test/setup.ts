/**
 * vitest の共通セットアップ。
 *
 * `@testing-library/jest-dom` のマッチャ（`toBeInTheDocument` 等）を登録し、
 * 各テストの後に描画済みの DOM を破棄する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * jsdom は `ResizeObserver` を持たない。仮想スクロール（TanStack Virtual）が
 * 表示領域の変化を追うのに使うため、最低限のものを補う。
 *
 * ブラウザにあって jsdom に無い API を埋めているだけで、アプリの振る舞いは
 * 差し替えていない。
 */
class 何もしないResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= 何もしないResizeObserver

/**
 * jsdom の `Range` は `getClientRects` を持たない。CodeMirror が文字の寸法を
 * 測るのに使うため、空の一覧を返すものを補う。
 *
 * 寸法が 0 でも、内容・属性・通知といったテストが見る範囲には影響しない。
 */
Range.prototype.getClientRects ??= function (): DOMRectList {
  const list = [] as unknown as DOMRectList
  return list
}

Range.prototype.getBoundingClientRect ??= function (): DOMRect {
  return new DOMRect(0, 0, 0, 0)
}

/**
 * jsdom の `navigator.platform` は空である。CodeMirror は読み込みの時点でこれを
 * 見て `Mod` を `⌘` と `Ctrl` のどちらへ割り当てるかを決めるため、そのままでは
 * `⌘F` などの macOS 向けのキーバインドがテストから叩けない。このアプリは macOS
 * だけを対象とする（CLAUDE.md）ので、実機と同じ Mac を名乗らせる。
 *
 * 設定ファイル（`setupFiles`）はテスト本体より先に走るため、CodeMirror が
 * 読み込まれる前に間に合う。
 */
Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

afterEach(() => {
  cleanup()
})
