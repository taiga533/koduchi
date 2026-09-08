# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

`koduchi`（小槌）は Oracle / PostgreSQL 対応の GUI データベースクライアント。Tauri v2 + React 19 + TypeScript + Vite + UnoCSS で作る。対象プラットフォームは macOS のみ。

設計判断はすべて `adr/` に記録してある。**実装前に `adr/README.md` を読むこと。** ADR に書かれた決定は蒸し返さない（却下した案とその理由も各 ADR に書いてある）。ADR で決まっていない判断が必要になったら利用者に確認する。

## コマンド

パッケージマネージャは **bun**（`bun.lock` が存在。`tauri.conf.json` の `beforeDevCommand` / `beforeBuildCommand` も `bun run` を呼ぶ）。

```bash
bun install              # 依存関係のインストール
bun run tauri dev        # デスクトップアプリを開発モードで起動（Vite + Rust を同時に立ち上げる）
bun run tauri build      # 配布用バイナリのビルド
bun run dev              # フロントエンドのみ Vite で起動（localhost:1420）
bun run build            # tsc による型チェック + Vite ビルド（型エラーはここで検出）
bun run test             # vitest でフロントエンドのテストを 1 回実行
bun run test:watch       # vitest をウォッチモードで起動
bun run lint             # oxlint
bun run format           # Prettier で整形（`format:check` は確認のみ）
cargo check              # src-tauri/ 配下で Rust 側の型チェック
cargo test               # src-tauri/ 配下で Rust 側のテスト
cargo clippy             # src-tauri/ 配下で Rust 側のリント
cargo fmt                # src-tauri/ 配下で Rust コードの整形
```

**テストとリンタの構成**（ADR 0010）:

- フロントエンド: `vitest` + `@testing-library/react` + `jsdom`。リンタは `oxlint`、フォーマッタは `Prettier`（`oxlint` 側は整形系ルールを無効にしてある）。
- Rust: `cargo test` / `cargo clippy` / `cargo fmt`。Oracle を使う統合テストは環境変数 `KODUCHI_TEST_ORACLE_URL` が設定されているときだけ走り、未設定ならスキップする。Docker が無い環境でも `cargo test` は緑になる。OS キーチェーンを実際に触るテストも同じ考え方で、`KODUCHI_TEST_KEYCHAIN` が設定されているときだけ走る。
- テストは Arrange - Act - Assert の順で書き、テストケース名は日本語で書く。mock は最小限に留め、フロントエンドは `src/api/` 層の差し替えで代替する。

## アーキテクチャ

フロントエンド（`src/`）と Rust バックエンド（`src-tauri/`）が Tauri の IPC で繋がる2層構成。

**Rust コマンドの追加手順**（この3点セットが揃わないと呼び出せない）:

1. `src-tauri/src/lib.rs` に `#[tauri::command]` を付けた関数を定義する
2. 同ファイル `run()` 内の `tauri::generate_handler![]` にその関数名を登録する
3. フロントエンドから `invoke("関数名", { 引数 })`（`@tauri-apps/api/core`）で呼ぶ。引数名は Rust 側の仮引数名と一致させる（JS 側は camelCase、Rust 側は snake_case で自動変換される）

`src-tauri/src/main.rs` は `koduchi_lib::run()` を呼ぶだけの薄いエントリポイント。実装は必ず `lib.rs` 側に置く（モバイル対応のため lib/bin が分離されている）。

**モジュールの割り当て**: 実装を置く場所は ADR README の「ディレクトリ構成」に従う。

| 場所                         | 役割                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `src-tauri/src/commands/`    | Tauri コマンド。薄い層に留め、待ちは `run_blocking` へ逃がす         |
| `src-tauri/src/db/`          | `Driver` trait とアクター・接続プール・Oracle 実装（ADR 0002・0003） |
| `src-tauri/src/db/schema.rs` | スキーマツリーの型とフィルタ（ADR 0007・0014）                       |
| `src-tauri/src/tnsnames/`    | tnsnames.ora の自前パーサ（ADR 0006）                                |
| `src-tauri/src/config/`      | `connections.toml` の読み書き（ADR 0004）                            |
| `src-tauri/src/keychain/`    | `keyring` の包み。パスワードだけを置く（ADR 0004）                   |
| `src-tauri/src/history/`     | 履歴とセッション復元の SQLite（ADR 0005）                            |
| `src-tauri/src/csv/`         | CSV の書き出し                                                       |

**設定ファイルの置き場所**: すべて `app_config_dir()`（`~/Library/Application Support/ninja.taiga533.koduchi/`）の下に置く。`instant_client.toml`（ADR 0001）/ `connections.toml`（ADR 0004・0013）/ `settings.toml`（テーマと CSV の書式）/ `history.sqlite3`（ADR 0005）の 4 つ。**パスワードはどれにも書かない。** キーチェーンのサービス名は `ninja.taiga533.koduchi`、アカウント名は接続の一意 ID である。接続を削除したらキーチェーンのエントリも必ず消す。

**権限（capabilities）**: Tauri v2 では API ごとに明示的な許可が必要。プラグインや core API を新たに使う場合は `src-tauri/capabilities/default.json` の `permissions` に追加する。追加を忘れると実行時に権限エラーで失敗する。動的に作るウィンドウ（ADR 0009）は `connection-` で始まるラベルを持ち、capability の `windows` がその前置きで受けている。ラベルの決め方を変えるときは両方を直す。

**ポート 1420 固定**: Vite は `strictPort: true` で 1420 に固定されており、Tauri がこの URL を読み込む。ポートを変える場合は `vite.config.ts` と `tauri.conf.json` の `devUrl` の両方を更新する。

**デザイントークンとテーマ**（ADR 0008）: 色は `src/theme/tokens.css` の CSS 変数に集約してある。`uno.config.ts` の `theme.colors` はその変数を参照するだけなので、UnoCSS のクラス（`bg-panel` / `text-fg3` など）を使えば自動的にテーマへ追従する。**色の値をコンポーネントへ直接書かない。** テーマの切替はルート要素の `data-theme` 属性 1 つで行う（属性なし = システム追従）。罫線の有無と行の高さは `data-grid-lines` / `data-row-height` で切り替える。属性の付け外しは `src/theme/appearance.ts` が担う。

**信号機の位置**（ADR 0009）: `trafficLightPosition` は見た目上のオフセットではない。tao はタイトルバーのコンテナの高さを `ボタンの高さ + y` に変え、ボタンの `origin.y`（実測 9）は据え置く。macOS は左下原点なので、結果として**ボタンの中心はウィンドウ上端から `y - 2` の位置**に来る。縦中央に置く値は `y = タイトルバーの高さ / 2 + 2`。導出と実測値は `src/components/titlebar/geometry.ts` にあり、`tauri.conf.json` との整合はテストで見張っている。**この値を目分量で調整しない。**

**アイコン**: `lucide-react` を使う。`✕` / `＋` / `⌕` のような文字の記号を直接置かない（字形が環境任せになり、字送りの都合で小さく潰れる）。大きさは `size` で 12〜15px の範囲に収め、色は `className` の `text-fg5` などトークン側で決める。

**補完**（ADR 0013）: 識別子の候補は `src/components/editor/sqlCompletion.ts` の自前の補完ソースが出す。`@codemirror/lang-sql` の `schemaCompletionSource` は**使わない**（階層の解決が大文字小文字を区別し、候補を必ず引用符付きで挿入するため）。名前は `catalog.ts` が大文字へ畳んだ鍵で引き、挿入する綴りは `identifiers.ts` が決める。**引用符は必要なときだけ付け、付けるときは綴りを変えない。** 方言は `dialect.ts` の `koduchiOracleDialect`（`PLSQL` から `doubleQuotedStrings` だけを落としたもの）で、補完ソースは**この方言の `language`** へ足す（`PLSQL.language` へ足しても繋がらない）。挿入する綴りは接続ごとの設定で `connections.toml` に持つ。

**スキーマツリーの種別**（ADR 0014）: 種別は 12 個（`ObjectKind`）。列挙元は `ALL_OBJECTS` の 9 種別に加え、索引が `ALL_INDEXES`（`GENERATED = 'N'` のみ）、DB link が `ALL_DB_LINKS` である。**所有者が `PUBLIC` のものは列挙しない**（公開シノニムだけで数万件になる）。**制約はツリーに出さない**（理由は ADR 0014。テーブル定義ビューを作る波で扱う）。ツリーはスキーマとオブジェクトの間に**種別の束**を 1 段挟む。束の並びは `OBJECT_KIND_ORDER`、鍵は `kindGroupKey`（`KODUCHI.#table`）。絞り込み中だけ束は既定で開く。種別ごとの表示可否は `SchemaFilter.kinds` として `connections.toml` に持ち、**落とした種別は問い合わせにも行かない**。補完のカタログには索引・トリガー・DB link を流さない（`catalog.ts` の `isCompletable`）。

**キーバインドの置き場所**: エディタの中でしか意味を持たない `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / `⌘.` と検索の `⌘F` / `⌘G` / `⇧⌘G` / `⌥⌘F` は CodeMirror の keymap に、それ以外（`⌘E` / `⇧⌘E` / `⌥⌘S` / `⌥⌘C` / `⌥⌘R` / `⌘S` / `⌘O` / `⌘T` / `⌘W` / `⌃⌘N`）は `App.tsx` の `keydown` に置く。後者は `event.defaultPrevented` を見て、エディタが既に処理したものを二重に扱わない。結果テーブルの中でしか意味を持たない `⌘C` / `⇧⌘C` / `⌘A` は `ResultTable` の `keydown` に置く。`⌘K` と `⌘I` は**割り当てない**（将来のための予約）。

**結果テーブルのコピー**: セル選択は `ResultTable` の中に閉じた状態で持つ（`ui` ストアへ置くと打鍵ごとにアプリ全体が描き直る）。タブを切り替えたときは `ResultPane` が `key={tabId}` で作り直し、選択を捨てる。範囲の判定とコピー文字列の組み立ては `src/components/results/selection.ts` の純粋な関数に寄せてある。クリップボードは `src/api/clipboard.ts` 越しに呼ぶ（テストで差し替えるため）。

**結果テーブルの列幅と詳細**: 列幅は `ui` ストアの `resultColumnWidths`（タブ ID → 列名 → 幅）に置く。選択と違って再実行やタブ切替をまたいで残す値だからである。幅の勘定は `src/components/results/columnSizing.ts` の純粋な関数に寄せてあり、内容合わせは実寸を測らず PlemolJP の送り幅（半角 0.528em、全角はその 2 倍）から見積もる。セルの詳細は `CellDetailPanel.tsx`。マウス操作の割り振りは `ResultTable.tsx` 冒頭の表に書いてある。**列のソートは実装しない**（理由は `adr/README.md`）。

**トランザクション**（ADR 0012）: 自動コミットは接続ごとの項目で、既定はオフ（手動コミット）。未コミットかどうかは実行のたびに `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` を読んで決める。**クライアント側で DML を数えない。** コミット / ロールバックはプールの全接続へ配る。未コミットのまま接続を手放させないための関所は `App.tsx` の `resolvePendingTransaction` にあり、ウィンドウを閉じる経路（`onWindowCloseRequested`）・アプリの終了（`lib.rs` の `RunEvent::ExitRequested`）・切断（`disconnectAndReset`）のすべてがここを通る。

**CSV の書き出し**: 行はフロントエンドに溜めない。カーソルから取り出したかたまりを `csv_append` で順に Rust へ渡し、書き終えたら `csv_finish` を呼ぶ（`src/csv/exportCsv.ts`）。中止と失敗では `csv_abort` で書きかけのファイルごと消す。数十万行を 1 度の IPC に載せないための形である。

**書体**: PlemolJP v3.1.0（等幅版、SIL OFL 1.1）を `src/assets/fonts/` に同梱し、`src/theme/fonts.css` で登録している。半角と全角の幅比が 1:2 なので、日本語を含むデータでも結果テーブルの桁が揃う。データベースの内容は任意の文字を含みうるため**サブセット化はしない**。収録ウェイトは 400 / 500 / 600 / 700 の 4 つ。

## 制約

- TypeScript は `strict` に加えて `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- アプリ識別子は `ninja.taiga533.koduchi`（`tauri.conf.json`）。
- バージョンの実体は `package.json` と `src-tauri/Cargo.toml` の 2 箇所だけ。`tauri.conf.json` の `version` は `"../package.json"` を参照しているので触らない。タグとの一致は `scripts/check-release-tag.sh` が見張る（ADR 0011）。
- Rust の版は `rust-toolchain.toml` で `1.98.0` に固定してある。GitHub Actions は commit SHA でピン留めする（更新は Dependabot が PR を出す）。
