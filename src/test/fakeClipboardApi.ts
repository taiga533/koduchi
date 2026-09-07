/**
 * テスト用のクリップボードの窓口（ADR 0010）。
 *
 * `src/api/clipboard.ts` を丸ごと差し替えて、書き込まれた文字列を記録する。
 * mock ライブラリを使わずに `⌘C` の中身を確かめられる。
 */

import type { ClipboardApi } from '../api/clipboard'

/** 記録付きのクリップボード。 */
export interface FakeClipboard extends ClipboardApi {
  /** 書き込まれた文字列を古い順に持つ。 */
  written: string[]
  /** 最後に書き込まれた文字列。一度も書いていなければ `null`。 */
  last(): string | null
}

/** 記録するだけのクリップボードを作る。 */
export function createFakeClipboard(): FakeClipboard {
  const written: string[] = []
  return {
    written,
    last: () => written.at(-1) ?? null,
    writeText: async (text: string) => {
      written.push(text)
    },
  }
}
