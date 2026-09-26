/**
 * 同期用パッケージのテスト（design-sync）。
 *
 * アプリ本体の vitest は `src/` だけを見るため、ここに別の設定を置く。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: { environment: 'jsdom', include: ['*.test.ts'] },
})
