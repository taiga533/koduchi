# 小槌 (koduchi)

Oracle / PostgreSQL 対応の GUI データベースクライアント。Tauri v2 + React 19 +
TypeScript + Vite + UnoCSS で作る macOS 向けデスクトップアプリ。

設計判断はすべて [`adr/`](adr/README.md) に記録してある。

## インストール

[リリースページ](https://github.com/taiga533/koduchi/releases)から `.dmg` を
ダウンロードし、`koduchi.app` を `/Applications` へ移す。Apple Silicon 向けの
ビルドのみを配布している。

配布物は Apple の Developer ID で署名し、公証（notarization）を通してある
（[ADR 0028](adr/0028-配布物の署名と公証.md)）。**そのまま起動できる。**

## 必要なもの

|                            |                                                                             |
| -------------------------- | --------------------------------------------------------------------------- |
| [bun](https://bun.sh/)     | パッケージマネージャ                                                        |
| [Rust](https://rustup.rs/) | Tauri のバックエンド                                                        |
| Oracle Instant Client      | Oracle への接続に必要（同梱しない。[ADR 0001](adr/0001-oracle接続方式.md)） |
| Docker                     | 開発用データベース。無くてもアプリのビルドとテストは通る                    |

### Oracle Instant Client

アプリには同梱していないため、別途インストールする。

```bash
brew tap InstantClientTap/instantclient
brew install instantclient-basic
```

見つからない場合はアプリが起動時に案内画面を出し、ライブラリのディレクトリを
指定できる。指定した値は次回以降の起動で使われる。

## 開発

```bash
bun install
bun run tauri dev
```

| コマンド              | 内容                                     |
| --------------------- | ---------------------------------------- |
| `bun run tauri dev`   | デスクトップアプリを開発モードで起動する |
| `bun run tauri build` | 配布用バイナリをビルドする               |
| `bun run build`       | 型チェック + フロントエンドのビルド      |
| `bun run test`        | フロントエンドのテスト（vitest）         |
| `bun run lint`        | oxlint                                   |
| `bun run format`      | Prettier で整形する                      |
| `cargo test`          | Rust のテスト（`src-tauri/` で実行する） |
| `cargo clippy`        | Rust のリント（`src-tauri/` で実行する） |

## 開発用データベース

`docker-compose.yml` に Oracle Free 23.9 を用意してある
（[ADR 0010](adr/0010-テストとリンタの構成.md)）。

```bash
docker compose up -d
```

初回起動はデータベースの作成とスキーマ投入で数分かかる。準備完了はヘルスチェックで判定できる。

```bash
docker compose ps          # STATUS が healthy になれば使える
docker compose logs -f     # 進み具合を見る
```

接続先:

|            |                           |
| ---------- | ------------------------- |
| 接続文字列 | `localhost:1521/FREEPDB1` |
| ユーザー   | `koduchi`                 |
| パスワード | `koduchi_dev`             |

投入されるスキーマ（`dev/oracle/initdb/`）:

| スキーマ            | 内容                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KODUCHI`           | `events`（50,000 行）・`orders`・`order_items`・`refunds`・`users`・`user_traits`、ビュー `session_rollup`、関数 `order_total`、プロシージャ `say_hello`（`DBMS_OUTPUT` の確認用）、値の型を網羅した `value_kinds`、および索引・トリガー・シノニム・型・パッケージ `order_stats`（[ADR 0014](adr/0014-スキーマツリーのオブジェクト種別拡張.md) の種別の確認用） |
| `KODUCHI_ANALYTICS` | 別スキーマの参照を試すための `daily_gmv` / `channel_cost` とビュー                                                                                                                                                                                                                                                                                              |
| `KODUCHI_EMPTY`     | オブジェクトを持たない。スキーマフィルタの確認用                                                                                                                                                                                                                                                                                                                |

`events` が 50,000 行あるのは、カーソルの分割取得（1,000 行ずつ、
[ADR 0003](adr/0003-結果セットのカーソル保持と接続プール.md)）が複数チャンクに
またがることを確かめるためである。

### Rust の統合テスト

環境変数が設定されているときだけ実行される。未設定なら該当テストはスキップされ、
Docker の無い環境でも `cargo test` は緑になる。

```bash
export KODUCHI_TEST_ORACLE_URL='koduchi/koduchi_dev@localhost:1521/FREEPDB1'
cd src-tauri && cargo test
```

OS キーチェーンを実際に読み書きするテストも同じ扱いにしてある。実行すると
キーチェーンへの書き込みが起きるため、明示的に指定したときだけ走る。

```bash
KODUCHI_TEST_KEYCHAIN=1 cargo test
```

作り直したいときは、ボリュームごと消してから起動する。

```bash
docker compose down -v && docker compose up -d
```

## リリース

`v*` のタグを push すると GitHub Actions が dmg を作り、**下書きの**リリースに
添付する（[ADR 0011](adr/0011-cicdとリリース配布.md)）。公開は人間が行う。

```bash
# 1. バージョンを上げる（package.json と src-tauri/Cargo.toml の 2 箇所。
#    tauri.conf.json は package.json を参照するので触らない）
# 2. main へマージする
# 3. タグを打つ前に検査する
./scripts/check-release-tag.sh v0.2.0
# 4. タグを push する
git tag v0.2.0 && git push origin v0.2.0
```

`check-release-tag.sh` は、タグ名と 2 つのマニフェストのバージョンが一致すること、
タグの指すコミットが `main` に含まれていることを確かめる。ワークフローの冒頭でも
同じ検査が走る。

ビルドが終わったら、下書きに添付された dmg を開けることを確かめてから、GitHub 上で
公開する。**公開したリリースは差し替えられない**（イミュータブルリリース）。

プルリクエストと `main` への push では、フロントエンド（型チェック・vitest・
oxlint・prettier）と Rust（fmt・clippy・test）の検査が走る。Tauri のフルビルドは
リリース時にだけ行う。

## 保存されるもの

`~/Library/Application Support/ninja.taiga533.koduchi/` の下に置かれる。

|                       |                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `instant_client.toml` | Instant Client のディレクトリ（[ADR 0001](adr/0001-oracle接続方式.md)）                  |
| `connections.toml`    | 接続設定。**パスワードは書かない**（[ADR 0004](adr/0004-認証情報と接続設定の保存先.md)） |
| `settings.toml`       | テーマ・罫線・行の高さと、CSV 保存の書式                                                 |
| `history.sqlite3`     | クエリ履歴とタブの復元（[ADR 0005](adr/0005-クエリ履歴とセッション復元のsqlite.md)）     |

パスワードは macOS Keychain に入る（サービス名 `ninja.taiga533.koduchi`）。
接続を削除するとキーチェーンのエントリも消える。

## キーバインド

| キー         | 動作                                      |
| ------------ | ----------------------------------------- |
| `⌘⏎`         | 実行（カーソル位置の文）                  |
| `⇧⌘⏎`        | 選択範囲のみ実行                          |
| `⌥⌘⏎`        | すべて実行（順に 1 文ずつ）               |
| `⌘E`         | 実行計画を生成                            |
| `⇧⌘E`        | 実測付きで生成                            |
| `⌥⌘S`        | 結果を CSV で保存                         |
| `⌘.`         | 実行を中止                                |
| `⌥⌘C`        | コミット                                  |
| `⌥⌘R`        | ロールバック                              |
| `⌘F`         | エディタ内を検索                          |
| `⌘G` / `⇧⌘G` | 次の一致 / 前の一致                       |
| `⌥⌘F`        | エディタ内を置換                          |
| `⌘S` / `⌘O`  | 保存 / 開く                               |
| `⌘T` / `⌘W`  | 新しいタブ / タブを閉じる                 |
| `⌃⌘N`        | 別の接続を新しいウィンドウで開く          |
| `⌘C` / `⇧⌘C` | 選択したセルをコピー / 見出し付きでコピー |
| `⌘A`         | 結果テーブルの表示中の全行を選択          |

`⌘C` / `⇧⌘C` / `⌘A` は結果テーブルに焦点があるときだけ効く。

## ライセンス

同梱している書体 PlemolJP v3.1.0 は SIL Open Font License 1.1 で配布されている。
ライセンス全文は [`src/assets/fonts/LICENSE.txt`](src/assets/fonts/LICENSE.txt) にある。
