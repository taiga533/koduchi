/**
 * UnoCSS の設定（ADR 0008）。
 *
 * 色は値を持たず `tokens.css` の CSS 変数を参照する。テーマ切替はルート要素の
 * `data-theme` 属性 1 つで行うため、`dark:` バリアントで色を二重に書き分ける
 * 必要がない。
 *
 * `uno.config.ts` からもテストからも同じ設定を使えるよう、`src/` 側に置いてある。
 * 生成される CSS は `utilities.test.ts` で検査している。
 */
import presetWind4 from '@unocss/preset-wind4'
import { defineConfig } from 'unocss'

export const koduchiUnoConfig = defineConfig({
  presets: [presetWind4()],
  theme: {
    colors: {
      /** 面 */
      bg: 'var(--bg)',
      panel: 'var(--panel)',
      panel2: 'var(--panel2)',
      fill: 'var(--fill)',
      fill2: 'var(--fill2)',

      /** 罫線 */
      line: 'var(--line)',
      line2: 'var(--line2)',
      /** 結果テーブルの罫線。表示設定で透明になる */
      gl: 'var(--gl)',

      /** 文字。数字が大きいほど淡い */
      fg: 'var(--fg)',
      fg2: 'var(--fg2)',
      fg3: 'var(--fg3)',
      fg4: 'var(--fg4)',
      fg5: 'var(--fg5)',
      fg6: 'var(--fg6)',

      /** アクセント（オリーブ固定） */
      ac: 'var(--ac)',
      acfg: 'var(--acfg)',
      acdiv: 'var(--acdiv)',

      /** SQL シンタックスハイライト */
      kw: 'var(--kw)',
      str: 'var(--str)',
      num: 'var(--num)',
      fn: 'var(--fn)',
      cmt: 'var(--cmt)',
      err: 'var(--err)',

      /** 差分表示（未使用。ADR 0008） */
      dmb: 'var(--dmb)',
      dmf: 'var(--dmf)',
      dpb: 'var(--dpb)',
      dpf: 'var(--dpf)',
    },
    font: {
      mono: 'var(--font-mono)',
    },
  },
})
