/**
 * Claude Design へ同期する部品のライブラリビルド（design-sync）。
 *
 * アプリ本体の `vite.config.ts` は Tauri の開発サーバ向けで、ライブラリを
 * 書き出さない。ここでは同じ UnoCSS の設定で `index.ts` を ES モジュールと
 * 1 枚の CSS に固める。React はデザインの描画環境が持つため外へ出す。
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import unocss from 'unocss/vite'
import { koduchiUnoConfig } from '../../src/theme/unoConfig'

const here = import.meta.dirname

/**
 * 出力の非 ASCII 文字を `\uXXXX` へ逃がす。
 *
 * 日本語を生のまま出すと、文字コードの指定が無いページで読んだときに正規表現の
 * 文字クラス（`/^無題-(\d+)\.sql$/` など）が化けて構文エラーになり、バンドル
 * ごと読めなくなる。esbuild の `charset: 'ascii'` は正規表現リテラルを逃がさない
 * ため、書き出す直前に 1 文字ずつ置き換える。`renderChunk` では早すぎる
 * （vite がライブラリ出力を esbuild で整え直し、`\u` を元の文字へ戻す）ので、
 * 全部の変換が済んだ後の `generateBundle` で行う。`\u` は文字列・正規表現・識別子の
 * どこでも同じ文字として読まれる。
 */
function asciiOnly(): Plugin {
  return {
    name: 'koduchi-ascii-only',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        chunk.code = chunk.code.replace(
          /[\u0080-\uffff]/g,
          (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
        )
      }
    },
  }
}

// デザインの側が自分で書く配置の糊にも色のクラスが効くよう、トークンの色を
// 使う代表的なクラスは src で使われていなくても生成しておく。
const colorNames = Object.keys(koduchiUnoConfig.theme?.colors ?? {})
const safelist = colorNames.flatMap((c) => [`bg-${c}`, `text-${c}`, `border-${c}`, `hover:bg-${c}`])

export default defineConfig({
  root: here,
  plugins: [
    unocss({
      ...koduchiUnoConfig,
      safelist,
      content: { filesystem: [resolve(here, '../../src/**/*.tsx')] },
    }),
    react(),
    asciiOnly(),
  ],
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    lib: {
      entry: resolve(here, 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    },
  },
})
