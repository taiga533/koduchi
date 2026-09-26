# design-sync の覚え書き（koduchi → Claude Design）

同期先: https://claude.ai/design/p/73f67dba-f0c9-422b-bbfb-3e1394390437（プロジェクト「koduchi」）

## 組み立て

- 小槌はアプリであり配布用の入口を持たない。`.design-sync/pkg/` が同期専用の小さなパッケージ（`koduchi-ui`）で、`index.ts` が `src/components` の部品・zustand のストア・型を書き出す。`src/` には手を入れていない。
- 組み立ては `.design-sync/build.sh` 1 本（vite のライブラリビルド → tsc の型 → `flatten-types.mjs` → 変換器）。`cfg.buildCmd` は変換器の手前までを持つ。vite の `emptyOutDir` が `dist/types` を消すので、**vite だけを流し直したら tsc と flatten も必ず流す**（流さないと変換器が部品 0 個と読む）。
- 型は `dist/types/.design-sync/pkg/` に出るが、変換器の glob はドットで始まるディレクトリを読み飛ばす。`flatten-types.mjs` が入口の型を `dist/types/` 直下へ移す。
- 書体（PlemolJP 4 ウェイト、計 8.8MB）は CSS に埋め込むと 12MB になるため、入口では読まず `cfg.extraFonts` が `src/theme/fonts.css` と woff2 を別送する。
- バンドルの非 ASCII は vite の `generateBundle` で `\uXXXX` へ逃がす。生のままだと文字コード指定の無いページ（validate の export 検査など）で `/^無題-(\d+)\.sql$/` が化けて構文エラーになり、`window.Koduchi` ごと読めなくなる。`renderChunk` では vite が後で esbuild に通して元へ戻すので効かない。
- `base.css` は `src/app.css` から document のスクロール止め（ADR 0031）を除いて写したもの。デザインでは縦に長い画面も組むため。
- Tauri の外では `browserApis.ts` が DB の窓口を「決着しない約束」の代役へ、クリップボードを `navigator.clipboard` へ差し替える。例外もメッセージも出ず、ストアは置いた状態のまま止まる。
- playwright は `.ds-sync/` に 1.58.2 を入れる（手元の chromium-1208 に合う版）。

## プレビューの書き方

- `import { X, useXStore } from 'koduchi-ui'`、型も `import type { ... } from 'koduchi-ui'`。
- 部品の多くは props ではなく**ストアから状態を読む**。モジュールの先頭で `useXStore.setState({...})` を呼んでから描く。ストアはページに 1 つなので、**1 枚のカードの見本はすべて同じ状態を共有する**。状態違いを並べたいときは、props で状態を受ける部品だけにする。
- 描いた直後にストアの読み込み（`load()` など）を呼ぶ部品は、その呼び出しが段階を `loading` へ書き換えてから決着しない。描いた後に状態を置き直す必要がある部品がある。
- `absolute` で置かれる部品（`RunButton` は編集領域の右下に浮く）は `position: relative` で寸法を持つ器に入れる。
- 横に広い部品（`ResultTable` / `StatusBar`）は `cfg.overrides.<Name>.cardMode = "column"`。器は `width: '100%'`。
- 変換器は `.prompt.md` の例を「export から次の export まで」の本文として切り出す。**補助の定数や関数は最初の export より前に置く**（間に置くと直前の例の一部として説明に混ざる）。
- **読み込み済みの姿**: 描いた直後に窓口から読む部品（`ConnectionPicker` / `ConnectionForm` / `CommandPalette`）は、モジュールの先頭で `setDbApi(createDesignDbApi({ listSavedConnections: async () => [...] }))` と答えを置く。書かなかったメソッドは決着しない。カードは 1 枚ずつ別のページなので、他のカードには響かない。
- **ストアの読み込みが段階を戻さない部品**: `SessionsPanel` は `overview` が既にあれば `load()` が段階を触らないので、`useSessionsStore.setState({ overview, status: 'ready' })` だけで済む。
- **タブ ID を鍵にするストア**（`useExecutionStore.byTab` / `useDefinitionStore.byTab`）は、見本ごとに別の `tabId` を渡せば 1 つのストアで状態違いを並べられる（`ResultPane` / `TableDefinitionPanel`）。ただし `useUiStore.resultTab` と `useExecutionStore.log` は全見本で共有される（`log` にエラーがあると全見本にメッセージのタブが出る）。
- **中の `useState` でしか開かない部品**（`SchemaFilterMenu` の開閉、`SavedQueryList` の名前の付け直し、`SchemaTree` の右クリック、`CommandPalette` の検索語）は、器に `ref` を持たせて `useEffect` で押す / `contextmenu` を送る / 入力欄へ値を入れて `input` を送る。二度走っても閉じないよう、開いているかを見てから押す。
- **`fixed` で出るメニューと暗幕**（`SchemaTreeContextMenu` / `ResultContextMenu` / オーバーレイ）は、器に `transform: 'translateZ(0)'` を付けると fixed の基準が器になり、カードの中に収まる。`absolute inset-0` のダイアログは寸法を持つ `position: relative` の器に入れる。
- **カードの幅**: 既定のカードで使える幅は 830〜870px ほど。見本の器が 860px を超えると右が切れる。撮影の一覧画像は縮小されているので目で幅を判断しない。横いっぱいに出す部品（`ResultTable` / `StatusBar` / `TitleBar` / `TabBar` / `SessionsPanel`）は `cardMode: "column"`。
- `ResultSearchBar` の `focusToken` は 0 のままにする（1 以上だと描いた瞬間に焦点を奪う）。
- `Sidebar` はストアの `sidebarSegment` を全見本で共有するため、スキーマの面だけを出した。履歴と保存済みの姿は `HistoryList` / `SavedQueryList` のカードにある。
- 中身は HR スキーマ（EMPLOYEES / DEPARTMENTS）と日本語の部署名など、実際に見そうなもので書く。

## Known render warns

- `[TOKENS_MISSING] --un-*`: UnoCSS（preset-wind4）が `@property` で定義している。validate が `@property` を定義と数えないための誤検知。

## 検査と CI

- リポジトリの CI は `prettier --check .` と `oxlint --deny-warnings` を `.design-sync/` にも掛ける。見本や入口を書き換えたら `bunx prettier --write .design-sync` と `bun run lint --deny-warnings` を通してから組み立てる。**整形は見本のソースを変えるので評価が消える**（撮り直して採点し直しになる）。整形を先に済ませてから撮ること。
- 入口の `browserApis.ts` のテストは `bunx vitest run --config .design-sync/pkg/vitest.config.ts`（アプリ本体の vitest は `src/` しか見ない）。

## Re-sync risks

- **入口の書き出しの一覧は手で持っている**（`pkg/index.ts`）。`src/components` に部品を足しても、ここに足さない限り同期されない。部品の名前を変えたら古い名前の書き出しが壊れて vite のビルドが落ちる。
- **ストアの形に見本が依存している。** 見本はストアへ `setState` で状態を直に置くため、ストアの項目名や `TabExecution` などの型が変わると、見本は型の検査なしに（esbuild は型を見ない）空の姿や例外で描かれる。再同期ではカードの見た目で気付くしかない。`conventions.md` のストアの表と例も同じ理由で古びる。
- **見本の中で DOM を触って開いている部品**（`SchemaFilterMenu` / `SavedQueryList` / `SchemaTree` の右クリック / `CommandPalette` の検索語）は、部品の中の要素の組み立て（ボタンの位置や `aria` の名前）に依存している。部品を作り替えたら開かなくなることがある。
- `base.css` は `src/app.css` の写し（document のスクロール止めを除く）。`app.css` に部品が頼る規則を足したら、こちらにも足す。
- playwright 1.58.2 は手元の chromium-1208 に合わせた版。chromium を入れ直したら版を合わせ直す。
- 書体は `src/theme/fonts.css` から送っている。ウェイトを足したら `extraFonts` 側は自動で追随するが、`conventions.md` は触れていない。
