/**
 * 型定義の置き場所を平らにする（design-sync）。
 *
 * tsc は `rootDir`（リポジトリの根）からの相対で型を書くため、入口の型が
 * `dist/types/.design-sync/pkg/index.d.ts` に出る。同期の変換器は型の木を glob で
 * 拾い、ドットで始まるディレクトリを読み飛ばすので、入口が見えず部品が 0 個になる。
 * 入口の型を `dist/types/` 直下へ移し、`src` への相対パスを書き直す。
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const types = join(import.meta.dirname, 'dist', 'types')
const nested = join(types, '.design-sync', 'pkg')

for (const name of readdirSync(nested)) {
  const text = readFileSync(join(nested, name), 'utf8').replaceAll("'../../src/", "'./src/")
  writeFileSync(join(types, name), text)
}
rmSync(join(types, '.design-sync'), { recursive: true })
