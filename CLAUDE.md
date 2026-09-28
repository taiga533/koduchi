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

**Oracle の統合テストの手順**: `src-tauri/`（Rust）に触れたら、`cargo test` に加えてこれを走らせる。

```bash
mise run test:oracle     # コンテナを起動して healthy まで待ち、URL を渡して cargo test --test oracle を走らせる
mise run oracle:reset    # dev/oracle/initdb を足した・変えたとき。ボリュームごと作り直す（数分かかる）
mise run oracle:down     # コンテナを止める（ボリュームは残す）
```

- **接続先の URL は `mise.toml` の `[vars]` の `oracle_url` 1 か所**にあり、`test:oracle` の実行中だけ `KODUCHI_TEST_ORACLE_URL` として渡る。形式は `ユーザー/パスワード@ホスト:ポート/サービス名` で、`docker-compose.yml` の `APP_USER` / `APP_USER_PASSWORD` と組である。**`[env]` へ移さない**（常に設定されると、コンテナの無いときの `cargo test` が接続に失敗して赤になる）。
- **`dev/oracle/initdb/` のスクリプトはデータベースを新規に作ったときにしか走らない。**既存のボリュームは後から足したスクリプトを知らないため、スキーマに依るテストが「期待した値が `None`」の形で落ちる。そのときはコードより先にボリュームの古さを疑い、`oracle:reset` する。スキーマを足すテストを書いたら、同じ変更で `initdb` にスクリプトを足す。
- **Instant Client が見つからないと統合テストは失敗せずに素通りする**（`Instant Client を読み込めないためスキップします` と出るだけで緑になる）。緑を報告する前に、出力にこの文言が無く件数が 0 でないことを確かめる。
- テストは `serial_test` で直列に走る（`oracle::InitParams::init()` がプロセスに 1 回きりのため）。統合テストのファイルは `src-tauri/tests/oracle.rs` 1 つで、足すテストもここに置く。

## アーキテクチャ

フロントエンド（`src/`）と Rust バックエンド（`src-tauri/`）が Tauri の IPC で繋がる2層構成。

**Rust コマンドの追加手順**（この3点セットが揃わないと呼び出せない）:

1. `src-tauri/src/lib.rs` に `#[tauri::command]` を付けた関数を定義する
2. 同ファイル `run()` 内の `tauri::generate_handler![]` にその関数名を登録する
3. フロントエンドから `invoke("関数名", { 引数 })`（`@tauri-apps/api/core`）で呼ぶ。引数名は Rust 側の仮引数名と一致させる（JS 側は camelCase、Rust 側は snake_case で自動変換される）

`src-tauri/src/main.rs` は `koduchi_lib::run()` を呼ぶだけの薄いエントリポイント。実装は必ず `lib.rs` 側に置く（モバイル対応のため lib/bin が分離されている）。

**モジュールの割り当て**: 実装を置く場所は ADR README の「ディレクトリ構成」に従う。

| 場所                             | 役割                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `src-tauri/src/commands/`        | Tauri コマンド。薄い層に留め、待ちは `run_blocking` へ逃がす         |
| `src-tauri/src/db/`              | `Driver` trait とアクター・接続プール・Oracle 実装（ADR 0002・0003） |
| `src-tauri/src/db/schema.rs`     | スキーマツリーの型とフィルタ（ADR 0007・0014）                       |
| `src-tauri/src/db/definition.rs` | テーブル定義の型と制約・索引の組み立て（ADR 0019）                   |
| `src-tauri/src/db/source.rs`     | ソース検索の型と結果のまとめ（ADR 0021）                             |
| `src-tauri/src/tnsnames/`        | tnsnames.ora の自前パーサ（ADR 0006）                                |
| `src-tauri/src/config/`          | `connections.toml` の読み書き（ADR 0004）                            |
| `src-tauri/src/keychain/`        | `keyring` の包み。パスワードだけを置く（ADR 0004）                   |
| `src-tauri/src/history/`         | 履歴・保存済みクエリ・セッション復元の SQLite（ADR 0005・0018）      |
| `src-tauri/src/csv/`             | CSV の書き出し                                                       |
| `src-tauri/src/menu.rs`          | メニューバー。既定のメニューへ項目を差し込む（ADR 0036・0040）       |
| `src-tauri/src/updater.rs`       | アップデートの再起動の予約と終了の判断（ADR 0042）                   |
| `src/mediator/`                  | 複数のストアにまたがる裁定とコマンドの表（ADR 0035）                 |

**仲介者**（ADR 0035）: 複数のストアにまたがる裁定（切断の後片付け・タブを閉じる・実行・未コミットの関所・CSV・ファイルの保存など）は `src/mediator/` の React に依存しない関数に置き、**裁定の領域ごとに**ファイルを分ける（`connection.ts` / `transaction.ts` / `execution.ts` / `tabs.ts` / `files.ts` / `savedQuery.ts` / `csv.ts` / `schema.ts` / `session.ts`）。`App.tsx` は仲介者を部品の callback と Tauri のイベントへ**配線するだけ**である。**ストアの中から別のストアを呼ばない**（ADR README「後片付けは仲介者が順に呼ぶ」）。画面にしか無いもの（エディタのカーソルとハンドル、確認の尋ね方）は**引数で受け取り**、仲介者は `SqlEditorHandle` も React の state も import しない。**利用者に尋ねるときは答えを `await` する。**画面の中に描く確認は `src/mediator/ask.ts` の尋ね事（`Ask`）として出し、`App.tsx` が受け渡し口（`createAskChannel`）から描いて答えを返す。**表示フラグを `App.tsx` の state に足さない。**部品は仲介者の値を import しない（型は許す）。`CsvExportDialog` / `TableCommandPalette` のような包みも、裁定を callback（`onExport` / `onRunCommand`）で受ける。ネイティブのダイアログは `src/api/dialog.ts` 越しに呼ぶ（テストで差し替えるため）。未コミットの確認（`transaction/pendingChanges.ts`）とタブを閉じる確認（`components/editor/closing.ts`）は専用の差し替え口を持つ。仲介者の単体テストは `App` を描かずに書き、`src/test/activeConnection.ts` の接続済みの状態から始める。

**設定ファイルの置き場所**: すべて `app_config_dir()`（`~/Library/Application Support/ninja.taiga533.koduchi/`）の下に置く。`instant_client.toml`（ADR 0001）/ `connections.toml`（ADR 0004・0013）/ `settings.toml`（テーマ・エディタの文字の大きさ・CSV の書式）/ `history.sqlite3`（ADR 0005）の 4 つ。**パスワードはどれにも書かない。** キーチェーンのサービス名は `ninja.taiga533.koduchi`、アカウント名は接続の一意 ID である。接続を削除したらキーチェーンのエントリも必ず消す。

**権限（capabilities）**: Tauri v2 では API ごとに明示的な許可が必要。プラグインや core API を新たに使う場合は `src-tauri/capabilities/default.json` の `permissions` に追加する。追加を忘れると実行時に権限エラーで失敗する。動的に作るウィンドウ（ADR 0009）は `connection-` で始まるラベルを持ち、capability の `windows` がその前置きで受けている。ラベルの決め方を変えるときは両方を直す。

**ポート 1420 固定**: Vite は `strictPort: true` で 1420 に固定されており、Tauri がこの URL を読み込む。ポートを変える場合は `vite.config.ts` と `tauri.conf.json` の `devUrl` の両方を更新する。

**デザイントークンとテーマ**（ADR 0008）: 色は `src/theme/tokens.css` の CSS 変数に集約してある。`uno.config.ts` の `theme.colors` はその変数を参照するだけなので、UnoCSS のクラス（`bg-panel` / `text-fg3` など）を使えば自動的にテーマへ追従する。**色の値をコンポーネントへ直接書かない。** テーマの切替はルート要素の `data-theme` 属性 1 つで行う（属性なし = システム追従）。罫線の有無と行の高さは `data-grid-lines` / `data-row-height`、エディタの文字の大きさは `data-editor-font-size` で切り替える。属性の付け外しは `src/theme/appearance.ts` が担う。**既定値のときは属性を付けない**（`tokens.css` は属性が無い状態を既定として書いてあり、付け外しの結果が設定値と一対一で対応する）。文字の大きさは 4 段階（`small` / `medium` / `large` / `xlarge`）の決め打ちで、値は `--fs-editor` が持つ。**結果テーブルの文字はこの設定では変わらない**（固定の行の高さと `columnSizing.ts` の見積りが追随しないため）。`settings.toml` を読む Rust 側（`commands/config.rs`）の項目には**すべて `#[serde(default)]` を付ける**。付け忘れると、その項目を持たない古いファイルで表ごと読み取りが失敗し、テーマも行の高さもまとめて既定へ戻る。

**信号機の位置**（ADR 0009）: `trafficLightPosition` は見た目上のオフセットではない。tao はタイトルバーのコンテナの高さを `ボタンの高さ + y` に変え、ボタンの `origin.y`（実測 9）は据え置く。macOS は左下原点なので、結果として**ボタンの中心はウィンドウ上端から `y - 2` の位置**に来る。縦中央に置く値は `y = タイトルバーの高さ / 2 + 2`。導出と実測値は `src/components/titlebar/geometry.ts` にあり、`tauri.conf.json` との整合はテストで見張っている。**この値を目分量で調整しない。**

**アイコン**: `lucide-react` を使う。`✕` / `＋` / `⌕` のような文字の記号を直接置かない（字形が環境任せになり、字送りの都合で小さく潰れる）。大きさは `size` で 12〜15px の範囲に収め、色は `className` の `text-fg5` などトークン側で決める。

**補完**（ADR 0013）: 識別子の候補は `src/components/editor/sqlCompletion.ts` の自前の補完ソースが出す。`@codemirror/lang-sql` の `schemaCompletionSource` は**使わない**（階層の解決が大文字小文字を区別し、候補を必ず引用符付きで挿入するため）。名前は `catalog.ts` が大文字へ畳んだ鍵で引き、挿入する綴りは `identifiers.ts` が決める。**引用符は必要なときだけ付け、付けるときは綴りを変えない。** 方言は `dialect.ts` の `koduchiOracleDialect`（`PLSQL` から `doubleQuotedStrings` だけを落としたもの）で、補完ソースは**この方言の `language`** へ足す（`PLSQL.language` へ足しても繋がらない）。挿入する綴りは接続ごとの設定で `connections.toml` に持つ。**「今どの表を相手にしているか」を読むのは `sqlScope.ts`** で、`FROM` / `JOIN` / `,` に加えて `UPDATE` / `INSERT INTO` / `DELETE` / `MERGE` の対象表と、`WITH` の共通表式・`FROM` の副問い合わせを見る。**出力の列名が決まらない項目は落とす**（`SELECT a + b` のような名前の付かない式に名前を作って出すと、実行して初めて `ORA-00904` になる候補を勧めることになる）。補完は打鍵の途中、つまり構文として壊れた文の上で走る。**書きかけの文で候補が消えたり例外が飛んだりしないことをテストで見張る。**

**スキーマツリーの種別**（ADR 0014）: 種別は 12 個（`ObjectKind`）。列挙元は `ALL_OBJECTS` の 10 種別に加え、索引が `ALL_INDEXES`（`GENERATED = 'N'` のみ）、DB link が `ALL_DB_LINKS` である。**所有者が `PUBLIC` のものは列挙しない**（公開シノニムだけで数万件になる）。**制約はツリーに出さない**（理由は ADR 0014。置き場所はテーブル定義ビューであり、ADR 0019 で実装した）。ツリーはスキーマとオブジェクトの間に**種別の束**を 1 段挟む。束の並びは `OBJECT_KIND_ORDER`、鍵は `kindGroupKey`（`KODUCHI.#table`）。絞り込み中だけ束は既定で開く。種別ごとの表示可否は `SchemaFilter.kinds` として `connections.toml` に持ち、**落とした種別は問い合わせにも行かない**。表・ビュー・列のコメントと列の型名もツリーに出し、可否は `SchemaFilter.showComments` / `showTypes`（ADR 0043）。**コメントは段階 2 で、出す設定のときだけ取る**（段階 1 は全スキーマぶんを 1 度に引くため混ぜない）。名前の右に 1 行で `…` に省き `title` で全文。取得し直すかは `needsRefetch` が決める（型名の切替では取り直さない）。絞り込み語は**見えているときだけ**コメントにも当てる。補完のカタログには索引・トリガー・DB link を流さない（`catalog.ts` の `isCompletable`）。

**テーブル定義タブと DDL**（ADR 0019・0022・0033）: ツリーの**右クリックのメニューの「定義を開く」**（またはツリーの中の `⌘D`）から、**エディタのタブ帯に定義タブとして**開く（ADR 0022。オーバーレイに出す作りと行の右の「定義」ボタンは 0022 で覆した。結果ペインの動的タブにはしない点は 0019 のまま）。**定義タブを選んでいる間はエディタも結果ペインも出さず、本体をまるごと `TableDefinitionPanel` が使う。**内訳は**列 / 制約 / 索引 / DDL** の 4 つで並びは固定。取得は 2 つのコマンドに分かれ、`object_definition`（列・制約・索引）は開いた時点で、`object_ddl`（`DBMS_METADATA.GET_DDL`）は **DDL の内訳を開いたときに初めて**走る。GET_DDL の権限が無いというだけで列も制約も見られなくなってはいけないためである。どちらもプールの `background_handle` で取り、利用者のカーソルには触れない（ADR 0003）。**GET_DDL の型名は `ALL_OBJECTS.OBJECT_TYPE` の綴りと違う**（`MATERIALIZED_VIEW` / `DB_LINK` とアンダースコアで繋ぐ）。`ObjectKind::ddl_object_type()` から引き、`object_type()` と取り違えない（`ORA-31600` になる）。**パッケージは仕様と本体を 2 度取る**（`PACKAGE` と `PACKAGE_BODY`）。整形は `SET_TRANSFORM_PARAM` で `SQLTERMINATOR` / `PRETTY` を真、`SEGMENT_ATTRIBUTES` / `STORAGE` を偽にする。**制約はツリーではなくここに出す**（ADR 0014 からの申し送り）。外部キーは参照先の表と列まで出し、`NOT NULL` を言っているだけの検査制約は落とす（`is_not_null_check`）。**索引は自動生成のものも出す。** ツリー（ADR 0014）と逆だが、主キーの索引が見えないと「この列で引けるのか」が分からない。列は段階 2 のキャッシュを使い回さず引き直す（読み込み中のスキーマで 0 件に見えないため）。絞り込みは列・制約・索引の 3 タブに効き、判定は `src/components/definition/definitionSearch.ts` の純粋な関数に寄せてある。**列はコメント（論理名）でも引ける**（ADR 0033）。**コメントは 2 か所に出す**（ADR 0033）。**内訳は 4 つのままで、5 つめは作らない。**オブジェクトそのもののコメント（`ALL_TAB_COMMENTS`）は見出しの下に、列のコメント（`ALL_COL_COMMENTS`）は列の内訳の 5 つめの欄に出す。**コメントの付いた列が 1 つも無いときは欄そのものを出さない**（判定は `hasColumnComments`。**絞り込む前の全列**に当てる。絞り込んだ後で判定すると、語を打つたびに表の形が変わる）。列のコメントは**列の問い合わせへ `LEFT JOIN` で混ぜる**（往復を増やさない）。**鍵は `(OWNER, TABLE_NAME, COLUMN_NAME)` の 3 つ揃いで、内部結合にしない**（片方を欠くと列が重複し、内部結合にするとコメントの無い表で列が丸ごと消える）。オブジェクトのコメントだけは 1 行の別の問い合わせで取る（列の問い合わせへ混ぜると同じ 4000 文字が列の数だけ返る）。**コメントは `object_definition` に相乗りさせ、新しいコマンドを作らない**（`ALL_*_COMMENTS` は `ALL_TAB_COLUMNS` と同じ PUBLIC の辞書ビューであり、GET_DDL のようにロールで落ちない）。引くのは `has_columns()` が真の 3 種別だけで、**それ以外は問い合わせにも行かない**（`has_comments()` は作らない。集合が完全に一致する）。`NULL` と空文字列と空白だけは `normalize_comment` が「無い」へ畳み（Oracle が区別しない）、**中身は切り詰めず折り返して全文を出す**。無い列は `—`。**ツリーの入口は右クリックの「定義を開く」1 つだけで、マウス操作の割り振りは足していない**（ADR 0022）。**見出しには表の統計とセグメントの大きさも出す**（ADR 0044）。取得は別のコマンド `object_stats` で、開いた時点で定義と並べて走らせる（`DBA_SEGMENTS` の権限と重さで列まで見られなくしないため）。**権限が無くて測れないことは 0 でも失敗でもなく `SegmentSize` の `permissionDenied` で返す。**自分の表は `USER_SEGMENTS`、他人の表は `DBA_SEGMENTS` で測る（`ALL_SEGMENTS` は無い）。`NUM_ROWS` は「行数（統計時点）」「約 N 行」と書き、統計が無ければ「不明」（0 と書かない）。古いかは `STALE_STATS` だけで決め、日数のしきい値は持たない。文言は `definitionStats.ts` の純粋な関数。列名の欄は折り返さない（長いコメントに押し潰されるため）。

**4 つの内訳はどれもコピーできる。**入口は内訳のタブの並びの右端の「コピー」1 つで、写すのは**今開いている内訳の、今画面に出ているもの**である。**コメントの欄も画面に出ているときだけ写す**（判定は画面と同じ `hasColumnComments`）。**オブジェクトそのもののコメントは写さない**（見出しであって内訳の中身ではない）。絞り込み中はボタンの文字が「絞り込んだぶんをコピー」に変わる（押した後の一言だけでは、欠けたものを貼ってから気づく）。表は見出し付きのタブ区切り、DDL は `GET_DDL` の出力を**そのまま**渡す（見出しも註釈も足さない）。組み立ては `src/components/definition/definitionCopy.ts` の純粋な関数。

**エディタのタブの 2 種類**（ADR 0022）: タブ帯（`TabBar.tsx`）には **SQL タブと定義タブ**が並ぶ。型は `src/stores/tab.ts` の `EditorTab`（`kind` で判別する union）で、**並びは 1 本の配列のまま**である。並び順・選択・閉じるは種類を知らずに書ける。種類による振り分けは `src/stores/tabKinds.ts` の純粋な関数（`isSqlTab` / `isDirty` / `openDefinitionTab` / `toSessionTabs` / `fromSessionTabs`）に寄せてある。**「今のタブの SQL」を要る操作はすべて `selectActiveSqlTab` を通す**（実行・`⌘S` / `⇧⌘S` / `⌃⌘S` / `⌥⌘S` / `⌃⌘E`）。定義タブでは何も起きない。**定義タブはセッションに保存しない**（定義は接続に属し、小槌は接続を復元しないため。Rust 側の `session_tab` / `session_state` には手を入れていない）。**同じオブジェクトの定義タブは 2 枚開かない。**定義の中身は `definition` ストアが**タブの ID を鍵にして**持ち、タブを閉じたら `drop(tabId)` で捨てる。`esc` では閉じない（タブは重なっていない。閉じるのは `⌘W`）。

**スキーマツリーからの操作**（ADR 0020・0022）: ツリーの行から名前をエディタへ入れられる。**挿入する綴りと引用符は `identifiers.ts` の `styleIdentifier` が決める**（ADR 0013）。自前で書き直さないこと。文字列の組み立ては `src/components/editor/insertion.ts` の純粋な関数（`qualifiedIdentifier` / `withLeadingSpace` / `selectAllStatement`）に寄せてある。オブジェクトは `TreeRow` の `owner`（ADR 0019 と共用）で**スキーマ修飾**し、**列は修飾しない**。挿入は `SqlEditor` の `insertAtCursor`（`SqlEditorHandle`）越しに CodeMirror へ差分として渡す。タブの内容を丸ごと差し替えるとカーソルが末尾へ飛ぶ。**挿入しても焦点はエディタへ移さない。**右クリックのメニューは「名前をコピー」「エディタへ挿入」「`SELECT` を開く」「定義を開く」の 4 つ。3 つめは列を持つ種別だけ、4 つめ（ADR 0022）はオブジェクトの行で繋がっているときだけ出す。**`SELECT` は新しいタブに入れるだけで実行しない**（結果セットのカーソルは接続 1 本につき高々 1 つで、実行すると別タブの結果が閉じられる。ADR 0003）。クリップボードは `src/api/clipboard.ts` 越しに呼ぶ。

**ツリーを取り直す入口は `SchemaReloadButton`（検索欄の隣、絞り込みのアイコンの左）1 つである**（ADR 0007 への 2026-09-11 の追記）。DDL を流した後に使う。**絞り込みメニューの中の「再読み込み」は消した**（同じことをする入口を 2 つ持たない）。コマンドパレットの「スキーマを再読み込み」も同じ動きで、**キーは割り当てない**（`⌘R` はウェブビューの再読み込みと重なる）。**取り直すのは常に全部**（段階 1 は `GROUP BY owner` の 1 クエリで全スキーマぶんを取るため、1 スキーマだけの取り直しでは新しいスキーマも消えたオブジェクトも映らない）。**読み込み中は押せない**（二度押しで 2 本目が走ると、どちらが後に返るか約束できない）。**開閉と絞り込み語は残る**（`run()` が捨てるのは `schemas` と `columns` と `objectComments` だけ）。補完のカタログは `EditorPanel` がストアから組み立てているため自動で追随し、**開いている定義タブの中身は取り直さない**（ADR 0022）。この行は**ツリーの行の操作ではない**ため、下の表には入れない。

マウス操作の割り振りは次のとおり。**この表がスキーマツリーの操作の持ち主である。**入口を足すときはここに 1 行を足す。

| 操作               | 起きること                                                           |
| ------------------ | -------------------------------------------------------------------- |
| 行を単クリック     | 開閉する（開けない行では何も起きない）                               |
| 行をダブルクリック | 開けない行でだけ、名前をエディタのカーソル位置へ挿入する（ADR 0043） |
| 行を右クリック     | コピー・挿入・`SELECT` を開く・定義を開く（ADR 0022）のメニュー      |

ダブルクリックは 1 回目と 2 回目の押し下げでそれぞれ `click` が起き、開閉が 2 度切り替わって元へ戻る。**`event.detail` を見て打ち消す細工は入れない**（結果テーブルの「ダブルクリックは 1 回目の押し下げで選択も起こる」と同じ扱い）。**開閉できる行（スキーマ・種別の束・表・ビュー・マテビュー）ではダブルクリックで挿入しない**（ADR 0043。素早い開閉とダブルクリックは区別できない。issue #72）。判定は `insertsOnDoubleClick`。**行の右に押しどころは無い**（「定義」のボタンと `data-row-action` の仕組みは ADR 0022 で消した）。足すときは `data-row-action` を付けてダブルクリックの挿入から外すこと（作法は ADR 0020 に残っている）。ツリーの中でだけ効くキーは `↑` / `↓` / `→` / `←` と `⌥⏎`（挿入）/ `⌘C`（コピー）/ `⌘D`（定義を開く。ADR 0022）で、`SchemaTree` の `keydown` に置く。仮想スクロールのため焦点は 1 行だけが持ち（roving tabindex）、行が描かれるまで待ってから当てる。

**タブ帯の並べ替えと閉じる**（ADR 0023・0032）: 未保存の `●` 印は**名前の左**、閉じるボタンは**常に右**に出す。**印とボタンを排他にしない**（未保存のタブが閉じられなくなる。`dirty` を持たないタブが並びに混ざっても破綻する）。印が無いときも 7px の場所は空けておき、打ち始めた瞬間に幅が動かないようにする。**タブを閉じる関所は `src/mediator/tabs.ts` の `closeTabAndRelease` 1 つ**で、`✕` も `⌘W` も右クリックの「他のタブを閉じる」「右側のタブを閉じる」（ADR 0038。1 枚ずつ通し、取り消されたらそこで止める）もそこを通る。`dirty` かつ本文が空白だけでないときだけ確認を挟み、判定は `src/components/editor/closing.ts` の `needsCloseConfirmation`、確認そのものは `setCloseTabDialog` で差し替えられる（`transaction/pendingChanges.ts` と同じ形）。並べ替えは `Splitter` と同じ Pointer Events（`setPointerCapture`・`document.body` の `user-select: none`）で行い、**HTML5 の drag and drop API も `dnd-kit` のようなライブラリも使わない**。落とす位置の計算は `src/components/editor/tabOrder.ts` の純粋な関数（`moveItem` / `dropIndex`）に寄せてある。隣のタブの**中心**を越えたときに入れ替え、ドラッグ中に随時動かす。閉じるボタンには `data-tab-action` を付け、そこから始めた動きでは掴まない（ツリーの `data-row-action` と同じ形）。並びは `session_tab.position` としてそのまま保存されるため **Rust 側に手は要らない**。タブは枚数が増えると縮み、下限（`tabSizing.ts`）まで縮んだら帯が横へスクロールする。下限は `●` 印・種別アイコン・閉じるボタンが**どこまで縮んでも見えている**幅として決まる。名前は `…` で省き、`title` で読める。`＋` はスクロールする器の外に置く。選んだタブが帯の外に居るときは必要な最小限だけ送る（`tabScroll.ts` の `revealOffset`）。掴んだまま端へ持っていくと帯が送られる（`autoScrollStep`）。**`tabOrder.ts` の `dropIndex` はスクロールしても手を入れなくてよい**（`getBoundingClientRect()` と `clientX` は同じ座標系で一緒にずれる）。**タブを別ウィンドウへ引き剥がす操作は作らない**（ADR README「ペインの大きさ」節の決定）。

**タブの名前の付け直し**（ADR 0032）: タブを**ダブルクリック**するか `F2`（`TabBar` の `keydown`）で名前を打ち直せる。**掴みとは食い合わない**（ADR 0023 のしきい値が「4px 動かすまでは掴まない」を既にやっており、ダブルクリックは動かない）。**`event.detail` を見て打ち消す細工は入れない**——打ち消すものが起きていない。閉じるボタン（`data-tab-action`）の上から始めたダブルクリックでは編集に入らず、**編集中のタブは掴まない**。**編集中は器の `keydown` も一切効かせない**（入力欄は器の中に描かれるので打鍵が上がる。macOS の `⌥←` / `⌥→` は入力欄の単語単位のカーソル移動であり、名前を打っている途中でタブが入れ替わってはならない）。**関所は `onPointerDown` と `onKeyDown` の 2 つで、必ず対にする。**`F2` は**修飾キーが 1 つでも付いていたら効かない**（`⇧F2` も含む）。名前は 2 つある。`EditorTab.name` が**自動の名前**（`無題-N.sql` / ファイル名 / オブジェクト名）、`SqlTab.customName` が**利用者が付けた名前**で、どちらを出すかは `src/components/editor/tabNaming.ts` の `tabDisplayName` が決める。**画面に出す名前は必ずここを通す**（`⇧⌘S` の既定名は `tabBaseName`、`⌘S` の保存先の既定は `tabFileName`）。**空文字と空白だけを確定すると `customName` が捨てられ自動の名前へ戻る**——取り消しの入口はこれ 1 つで、別に作らない。**ファイルへ保存し直しても利用者の名前は消えない**（`markSaved` は `name` しか書き換えない）。隠れた自動の名前は器の `title` に `売上集計（users.sql）` の形で出る。**定義タブの名前は変えられない**（`canRenameTab`。名前がオブジェクトの同一性そのものであり、しかもセッションに保存されない。ADR 0022）。**保存済みクエリの名前は書き戻さない**（軽い操作から取り返しの付かない書き換えを起こさない。入口は `SavedQueryList` の鉛筆にある）。`esc` で取り消し、**焦点が外れたら確定する**。**変換中の `⏎` / `esc` では何も起きない**（ADR 0025。`isComposingKey` を先頭で見る）。**編集中もタブは広がらない**——入力欄は名前の場所に重なり、`●` 印と閉じるボタンは出たままなので `tabSizing.ts` の下限は変わらない。名前は `session_tab.custom_name` としてセッションへ保存し、列は `add_missing_columns` が無ければ足す（古い `history.sqlite3` はそのまま開ける）。

**SQL の整形**（ADR 0024）: `⇧⌥F` で整形する。**選択範囲があればその範囲だけ、なければタブ全体**を整形する。整形は `sql-formatter` 15.8.2 がフロントエンドで行い、**Rust 側には置かない**（接続していなくても使えるべきだからである）。方言は `plsql` 固定で、接続の有無や接続種別では切り替えない。**整形が変えてよいのは空白の置き方だけである。**入力と出力を `src/sql/tokens.ts` の字句の並びで照合し、1 つでも食い違えば**整形を取りやめて本文に触れない**（`sql-formatter` 15.8.2 は改行を含む `q'[...]'` を `q` と `'[...]'` に割る）。走査の下ごしらえは `src/sql/scan.ts` が持ち、**文の切り出し（`statements.ts`）と同じ判定を通す**。**切り出した文の `text` が Oracle へ渡す本文そのもの**で、SQL は末尾の `;` を落とし、PL/SQL 単位は `END;` の `;` まで含む。`⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / `⌘E` のどれもこれを通し、実行の直前や Rust 側で `;` を足し引きしない（ADR 0039）。綴りは畳まない（`keywordCase` などはすべて `preserve`。ADR 0013 と同じ考えであり、照合の前提でもある）。**書式は決め打ちで、設定の項目は作らない。**整形できなかったときは `execution` ストアの `noteFormatFailure` でメッセージタブへ出し、そこへ切り替える。書き換えは前後の変わらない部分を削った**差分**として CodeMirror へ渡す（`src/components/editor/formatting.ts` の `unchangedEnds`）。丸ごと置き換えるとカーソルが末尾へ飛ぶ。選択範囲のときは 2 行目以降を `selectionIndent` の下げ幅へ揃える。入口は `⇧⌥F` とコマンドパレットの「SQL を整形」とメニューバーの Edit の「SQL を整形」（ADR 0040）の 3 つで、どれも `SqlEditorHandle.formatDocument` を通る。**定義タブではエディタそのものが描かれないため何も起きない**（ADR 0022。判定は書き足さない）。

**実行される文の範囲の表示**（ADR 0047）: 実行の対象（`⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / 実行計画）を決めるのは `src/sql/runTarget.ts` の `runTargetOf` 1 つで、仲介者の実行はここを通る。エディタの縦線（`statementRange.ts`）は本文が変わったときだけ切り出し、`runTargetOf` の `statement` と同じ選び方の `pickStatementAt` を直に呼ぶ。**表示の側で範囲の決め方を別に書かない**（光った範囲と流れた文がずれる）。光らせる範囲は仲介者が `RunScreen.highlight` で渡し、**実行に入れるか（`runContextFor`）を見てから光らせる**（未接続・同じタブが実行中では光らせない）。縦線は選択があっても `⌘⏎` の文を示し、50,000 文字を超える本文では開いた直後と打鍵の間だけ消す（古い範囲をずらして使い回さない）。

**キーバインドの置き場所**: エディタの中でしか意味を持たない `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / `⌘.` と検索の `⌘F` / `⌘G` / `⇧⌘G` / `⌥⌘F` と整形の `⇧⌥F`（ADR 0024）は CodeMirror の keymap に、それ以外（`⌃⌘E` / `⌃⇧⌘E` / `⌥⌘S` / `⌃⌘C` / `⌃⌘R` / `⌘S` / `⇧⌘S` / `⌃⌘S` / `⌘O` / `⌘N` / `⌘W` / `⇧⌘N` / `⇧⌘P` / `⇧⌘F`）は `src/mediator/commands.ts` の**コマンドの表**（`COMMANDS`、1 行 1 コマンド）に置く（ADR 0035）。`App.tsx` の `keydown` の振り分け（`dispatchCommandKey`）とコマンドパレットの一覧は**どちらもこの表から作る**。**パレットの一覧を組むのは `src/components/palette/commandEntries.ts` の `paletteCommands` である**（キーの表記は `src/keybindings/bindings.ts` の `shortcutLabelFor`）。`App.tsx` が表（`COMMANDS`）と実行の口（`runCommand` に画面を添えたもの）をパレットの包み（`TableCommandPalette`）へ渡し、包みの中でこれを呼ぶ。キーかパレットのどちらかにだけ操作を足さない。振り分けは `event.defaultPrevented` を見て、エディタが既に処理したものを二重に扱わない。修飾は**完全に一致したときだけ**当てる（`findCommandForKey`。ADR 0037）。CodeMirror の keymap が振り分けるキー（`⌘⏎` など）も表に `scope: 'editor'` の行として置き、表はウィンドウでは振り分けない。keymap は `editorKeys.ts` の `findEditorAction` で同じ割り当てから当てる。結果テーブルの中でしか意味を持たない `⌘C` / `⇧⌘C` / `⌘A` と `⌘F` / `⌘G`（表の中の検索。ADR 0027）は `ResultTable` の `keydown` に置き、スキーマツリーの中でしか意味を持たない `↑` / `↓` / `→` / `←` / `⌥⏎` / `⌘C` / `⌘D` は `SchemaTree` の `keydown` に置く（ADR 0020・0022）。タブ帯の中でしか意味を持たない `⌥←` / `⌥→`（タブの並べ替え。ADR 0023）と `F2`（タブの名前の付け直し。ADR 0032）は `TabBar` の `keydown` に置く。`⌘I`（Ask AI）は**割り当てない**（将来のための予約）。`⇧⌘P` はコマンドパレット、`⇧⌘F` はオブジェクトのソース検索（ADR 0021）に割り当て済みで、`⌘K` は VSCode の 2 打鍵の前置キーであるため空けてある（ADR 0037）。`⌘D`（定義タブを開く）はツリーの中だけで効く（ADR 0022）。`⇧⌘F` は CodeMirror の `⌘F` とは修飾が違うため食い合わない。`⇧⌥F`（SQL の整形、ADR 0024）だけは keymap へ**キーの名前で登録できない**。macOS では `⌥` を伴う打鍵で文字そのものが変わる（US でも JIS でも `Ï`）ため、keymap の `any` から打鍵を直に見て、`⌥` が付いていれば `event.code` で読む（`src/keybindings/chord.ts` の `matchesChord`。ADR 0037 で全部の組み合わせへ広げた）。

**キーの割り当て直し**（ADR 0037）: 既定は VSCode の mac 版に寄せてあり、コマンドの表の行（`scope` が `window` と `editor` の両方）は設定画面から割り当て直せる。**表が持つのは既定（`defaultKey`）だけ**で、今のキーは `src/keybindings/bindings.ts` の `resolveKeybindings` が既定と `settings.toml` の `[keybindings]`（**既定との差分だけ**。空文字は「外した」）から決める。解決は `App.tsx` で 1 度だけ行い、`src/keybindings/context.ts` の context で配る（部品は仲介者の値を import しないため）。**ボタンやメニューにキーの表記を手で書かない**。`useShortcutLabel(id)` で引く。部品の中のキー（結果テーブル・ツリー・タブ帯）とエディタの検索は割り当て直せず、`FIXED_KEYS` に写しを持つ。部品の中にキーを足したらここにも 1 行を足す（記録の欄が断れなくなる）。**読み損ねても既定のキーで起動する**（読めない行はその操作だけ既定に戻し、Rust 側は文字列でない行を捨てる）。**ネイティブのメニューに表のキーをアクセラレータとして付けない**（割り当て直した後もメニューが古いキーを握り続ける。`⌘,` だけはメニューが持つ）。メニューの項目（ADR 0040）は押されたらコマンドの表の**識別子**を焦点のあるウィンドウへ送り（`koduchi://menu-command`）、`App.tsx` が `runCommand` へ繋ぐ。項目を足すときは `menu.rs` の `MENU_COMMANDS` に 1 行を足す。

**変換中の打鍵（IME）**（ADR 0025）: 日本語の変換確定の `⏎` は「決定」ではない。**修飾キーの付かない打鍵（`⏎` / `esc` / `↑` / `↓`）を扱うハンドラは、先頭で `src/input/ime.ts` の `isComposingKey(event)` を見て、真なら何もせずに戻る。`<form>` には `onKeyDown={blockComposingSubmit}` を付ける**（中の欄が日本語を打つ欄かで判断しない）。**オーバーレイの `esc` だけは例外で、`useEscapeKey` が関所ごと持っている**（ADR 0031。下記）。判定は **`isComposing` と `keyCode === 229` の両方**を見る。片方だけでは確定の打鍵を取りこぼす（変換を確定する `⏎` は `isComposing` が偽で届く。実測は ADR 0025 の「1-2」）。`⌘` や `⌥` を必須にする打鍵には要らない。**CodeMirror の本文にも足さない**（`@codemirror/view` が既に捨てている）。**`⌘F` の検索パネルだけが例外**で、`search.tsx` の捕捉相の関所が `keyup` と `keydown` を止める（ADR 0025 の「1-3」）。**入力欄や `<form>` を足したら ADR 0025 の監査の表に 1 行を足す。**

**オーバーレイの `esc` と document のスクロール**（ADR 0031）: **オーバーレイの `esc` は器の `onKeyDown` で受けない。**焦点は簡単に抜ける（暗幕の `div` を押すだけで `document.activeElement` は `<body>` へ戻る）ため、器で受けると閉じる道が無くなる。入口は `src/input/useEscapeKey.ts` の `useEscapeKey(onClose)` 1 つで、打鍵は `window` の `keydown` で受け、受け手は `src/input/escapeStack.ts` の積みに入る。**走るのはいちばん後に開いた 1 つだけ**である（重なったオーバーレイが 1 打鍵でまとめて消えない）。見る順は `event.defaultPrevented` → `isComposingKey`（ADR 0025）→ 積みの末尾で、**どれも飛ばさない。**渡す関数の同一性は `useRef` で保つ（描画のたびに積み直すと順序が崩れる）。**`window` に自分で `keydown` を張らない。`App.tsx` に `esc` の枝を足さない。コマンドの表に `esc` の行も足さない。**オーバーレイを足したら `useEscapeKey` を呼ぶだけでよい。`SessionsPanel` / `SourceSearchPanel` のように「まず中の状態を解き、次に閉じる」2 段の動きは、渡す関数の中で分岐する。パレットの暗幕は自分自身が押されたときだけ `mousedown` の既定動作を止めて焦点を奪わせないが、**これは原因の側の手当てであって閉じる道の保証ではない。**／ **エディタのテーマの `&` に寸法を書かない。**`SqlEditor` は `tooltips({ parent: document.body })` で補完の候補を編集領域の外へ出しており、`@codemirror/view` はこのとき本体直下に入れ物の `div` を 1 枚作って**エディタと同じテーマの class だけ**を付ける。`&` はその class そのものを指すため、`&` に `height: 100%` を書くと空の入れ物にもビューポート 1 枚ぶんの高さが付き、本体の下に白い帯が生まれて document がその分スクロールする（issue #37 の正体）。高さは `&.cm-editor` へ書く（`.cm-editor` は編集領域にしか付かない）。選択の地は `koduchiEditorTheme` に含めた `drawSelection` が行の高さで描く（WebKit の `::selection` は文字の高さしか塗らず、行の間にすき間が出る。issue #54）。そのため**横の余白は `.cm-content` ではなく `.cm-line` に置く**（`drawSelection` は行の `padding-left` から矩形を描く）。`fontSize` と `color` は `&` のままでよい（補完の候補が継ぐ）。見張りは `src/components/editor/theme.test.ts`。**`parent: document.body` はやめない**（編集領域の中に足し引きすると入力の最中に DOM が動いて変換に割り込む）。／ **document はスクロールさせない**（守りであって直しではない）。`src/app.css` の `html` と `body` に `overflow: hidden` と `overscroll-behavior: none` を置いてある。後者は WKWebView のラバーバンドと、器の中から document へのスクロールの伝播を止める。**器の中のスクロール（仮想スクロール）には影響しない。**高さは `height: 100%` の連なり 1 本で決め、**`100vh` にも `100dvh` にも替えない**（実測で連なりはウィンドウの高さとぴったり一致しており、`vh` は一致しない）。**`overflow: hidden` は溢れを覆い隠す。**実際に issue #37 の原因を一度隠した。決めた宣言が消えていないことは `src/app.css.test.ts` が見張るが、**それは「溢れが無いこと」の見張りではない**。原因の側を捕まえるのは `theme.test.ts` である。読み取りは `src/theme/cssRules.ts` の純粋な関数で、**ブロックを持つ at-rule を見つけたら例外を投げる**（黙って読み飛ばすと `@media` の中の規則を top-level として拾い、テストが緑のまま嘘をつく）。

**右クリックのメニュー**（ADR 0038）: 器は `src/components/menu/ContextMenu.tsx` 1 つで、**焦点を奪わない・`esc` は `useEscapeKey`・画面の端で反対側へ開く（`placement.ts`）**を持つ。メニューを足すときはこれを使い、項目は**既存の操作の別の入口**に留める（キーの表記は `useShortcutLabel`）。ウェブビューの既定のメニューは `src/input/nativeContextMenu.ts` の関所が `main.tsx` で止めている（「再読み込み」が画面と実体を食い違わせるため）。**入力欄・`contenteditable`（エディタの本文）・選んだ文字の上では止めない。**エディタの本文には自前のメニューを出さない。選んだ文字の判定は押した点と選択の矩形で行う（`isOnSelectedText`）。**セッションの kill は右クリックに置かない。**

**結果テーブルのコピー**: セル選択は `ResultTable` の中に閉じた状態で持つ（`ui` ストアへ置くと打鍵ごとにアプリ全体が描き直る）。タブを切り替えたときは `ResultPane` が `key={tabId}` で作り直し、選択を捨てる。範囲の判定とコピー文字列の組み立ては `src/components/results/selection.ts` の純粋な関数に寄せてある。クリップボードは `src/api/clipboard.ts` 越しに呼ぶ（テストで差し替えるため）。**右クリック（と `⌃` + クリック）の押し下げでは選択を始め直さない**（`startsSelection`。ブラウザは `contextmenu` の前に `button` が 2 の `mousedown` を起こし、始め直すと範囲が 1 セルへ潰れる。issue #53）。テストで右クリックを起こすときは `contextmenu` だけでなくこの順で起こす。**メニューも詳細パネルも閉じた後の焦点を表に残す**（抜けると選択が見えたまま `⌘A` / `⌘C` が届かない）。結果ペインのエラー（失敗の通知・メッセージタブ・実行計画）には `ErrorCopyButton` を添え、文言を**手を加えずに**写す（issue #56）。

**結果テーブルの列幅と詳細**: 列幅は `ui` ストアの `resultColumnWidths`（タブ ID → 列名 → 幅）に置く。選択と違って再実行やタブ切替をまたいで残す値だからである。幅の勘定は `src/components/results/columnSizing.ts` の純粋な関数に寄せてあり、内容合わせは実寸を測らず PlemolJP の送り幅（半角 0.528em、全角はその 2 倍）から見積もる。セルの詳細は `CellDetailPanel.tsx`。マウス操作の割り振りは `ResultTable.tsx` 冒頭の表に書いてある。**列のソートは実装しない**（理由は `adr/README.md`）。**64KB を超えて切り詰められた `CLOB`** は `Cell.truncated` で届くので、詳細パネルでは本文の上に注意書きを出し、文字数にも「先頭 64 KB のみ」を添える（ADR 0021 の「黙って切り詰めない」）。**本文とクリップボードには印を混ぜない。**

**列の固定と表示調整**（ADR 0048）: 固定は見出しの右クリックの「この列まで固定」「列の固定を解除」だけが入口で、`position: sticky` で行う（固定した列の幅は決め打ち）。表示調整（3 桁区切り・空白の可視化）は**描く文字だけ**を変え、**コピー・CSV・詳細パネルは値（`displayText`）のまま**、列幅の内容合わせは描く文字で測り、検索は両方に当てる（`resultDisplay.ts`）。既定は `settings.toml` の `[resultDisplay]`、ヘッダーの `sliders-horizontal` はそのタブだけを上書きする。列幅・上書き・固定の寿命は同じで、タブを閉じると `forgetResultView` がまとめて捨てる。

**結果テーブルの検索**（ADR 0027）: `⌘F` で探し、`⌘G` で次の当たりへ移る。**当て先は `displayText(cell)` であって `Cell.text` ではない**（画面に見えている文字列を探す。NULL のセルは `null` と打てば拾える）。表示調整（ADR 0048）で描く文字が値と違うときは、描く文字にも当てる。**探せるのは取得済みの行だけである**ため、件数だけを出さず、カーソルが尽きるまでは**走査した行数を必ず添える**。「3 件」とだけ書いてはならない。切り詰められた値を走査したときはその旨も添える。判定は `src/components/results/resultSearch.ts` の純粋な関数、状態は `ResultTable` の中に閉じる。ソートを実装しない決定には触れない（検索は順序を偽らない）。

**問い合わせ以外の文の結果**（ADR 0034）: `CREATE TABLE` に「0 行」と出さない。**行数に意味があるかは Oracle から受け取る**（`Statement::statement_type()`。ODPI-C の `dpiStmtInfo.statementType`）。**クライアント側で SQL を読んで DDL か DML かを判定しない**（ADR 0012 の「クライアント側で DML を数えない」と同じ筋である）。判定は `src-tauri/src/db/oracle/mod.rs` の `has_row_count` 1 つで、真になるのは `Insert` / `Update` / `Delete` / `Merge` だけ。**`Unknown` は偽に倒す**（`GRANT` / `TRUNCATE` などが届く。どれも行を数えない）。運ぶのはその 1 ビットだけであり、`ExecuteOutcome::Statement.affected_rows` は `Option<u64>`。**種別そのものはフロントエンドへ送らない。**文言は「完了しました · 8 ms」（ヘッダーは `formatResultSummary`、本文は `formatStatementOutcome`。どちらも `src/stores/execution.ts`）。**何を作ったかは言わない**（「表 FOO を作成しました」は SQL の解析に逆戻りする）。**1 行も当たらなかった DML の「0 行に影響しました」は正しいので変えない。**スクリプト実行では行数を持つ文だけを足し上げ、1 つも無ければ合計は `null` にする。履歴の `row_count` も `null` で残す（`0` と書くと空振りした DML と見分けが付かない）。**未コミットの表示には触らない**（ADR 0012 が実行のたびに `LOCAL_TRANSACTION_ID` を読むため、DDL の暗黙のコミットは既に正しく反映される）。

**PL/SQL のコンパイルエラー**（ADR 0045）: 検出は `ORA-24344` の警告（`Connection::last_warning()`。往復しない）で行い、**対象は SQL から名前を読まず**、実行の間に `LAST_DDL_TIME` が動いたオブジェクトの `ALL_ERRORS` を同じ接続で引く（`src-tauri/src/db/oracle/compilation.rs`）。窓の起点は `SYSDATE` ではなく辞書の最新の `LAST_DDL_TIME` に置く（時計の基準がずれる構成があるため）。**`ALL_ERRORS` を読めなくても文は成功（警告付き）のまま返し、理由を `lookup_error` に載せる。接続断だけはエラーで返す**（`CompilationReport::settle`）。報告は `ExecuteOutcome::Statement.compilation` に載せ、**フロントエンドは失敗として扱う**（スクリプトもそこで止まる。文言は `src/stores/compilation.ts`）。行と桁は `ALL_ERRORS` の値のままで、エディタの行へ読み替えない。ツリーは `INVALID` のオブジェクトに印を出し、パッケージと型は本体が無効なときも仕様の行に立てる（`SchemaObject.invalid`）。

**保存済みクエリとコマンドパレット**（ADR 0018）: 保存済みクエリは `history.sqlite3` の `saved_query` 表に置く。履歴と同じく全接続で 1 つの表であり、接続名を添えてスコープを切り替える（**既定は「全接続」**。履歴と逆である）。**バインド変数の値は保存しない。** パレット（`⇧⌘P`）が探すのはコマンド / スキーマ / 保存済みクエリ / 履歴の 4 種で、**見出しの並びは固定**、当たり判定と順序は `src/components/palette/paletteSearch.ts` の純粋な関数に寄せてある。拾い方は大小を区別しない**部分一致**であり、あいまい一致は使わない。列はパレットの候補にしない（補完の領分、ADR 0013）。**履歴の行の右クリックからも積める**（ADR 0041。`saveQueryFromHistory`）。名前を尋ねるところ（`askQueryName`）と書き込み（`save`）はエディタからの保存と共有し、**添える接続名は履歴の行のもの**である。同じ SQL が保存済みならダイアログで告げるが、保存は止めない。**履歴の全文は、焦点かホバーの行についてだけ右隣に浮かせて出す**（ADR 0046。一覧の行は広げない）。成否の絞り込みは件数の上限より先に効かせるため**問い合わせに載せ**（`HistoryQuery.succeeded`）、保存しない。

**トランザクション**（ADR 0012）: 自動コミットは接続ごとの項目で、既定はオフ（手動コミット）。未コミットかどうかは実行のたびに `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` を読んで決める。**クライアント側で DML を数えない。** コミット / ロールバックはプールの全接続へ配る。未コミットのまま接続を手放させないための関所は `src/mediator/transaction.ts` の `resolvePendingTransaction` にあり、ウィンドウを閉じる経路（`onWindowCloseRequested`）・アプリの終了（`lib.rs` の `RunEvent::ExitRequested`）・切断（`disconnectAndReset`）のすべてがここを通る。**接続が切れているときは素通しする**（届かないコミットを尋ねて袋小路へ入れない。ADR 0026）。

**接続断**（ADR 0026・0030）: サーバ側で切れたこと（`ORA-02396` / `ORA-03113` など）は `DbErrorKind::ConnectionLost` で表す。**`Closed`（小槌が自分で閉じた）とも `Connect`（繋ぎ直しても駄目）とも別物**であり、取り違えると再接続の道が出ない。番号からの写し替えは `src-tauri/src/db/oracle/errors.rs` の `classify` に集め、**接続断を権限より先に見る**（切れた接続へ辞書ビューを引くと `ORA-03113` が返り、それを「権限が無い」と読ませてはならない）。**`DbError::execute` を直に作らず `map_execute_error` を通す**。通さない経路はその経路だけが断に気付けない。**1 本の断はプールごとの断として扱い**（`pool.rs` の `lost`）、印が立った後は往復せずその場で返す。フロント側は `src/api/` の窓口を丸ごと包む `src/connection/lost.ts` の見張り 1 つで気付き、仲介者の `relayConnectionLost`（`src/mediator/connection.ts`）が `connection` / `execution` ストアへ順に配る（切断の後片付けと同じ形）。**繋ぎ直しは自動で行わない**（未コミットの変更はサーバ側でロールバック済みであり、繋ぎ直した接続は別のセッションである）。切れた時点で「未コミット」の表示を降ろし、**降ろしたことをメッセージタブへ残す**。**報せるのは段階が実際に変わったときだけ**（`markLost` の戻り値で見る）で、切れた後に触るたびに同じ行を積まない。繋ぎ直しの失敗は押した回数だけ残す。**問い合わせを投げる生存確認はしない**（その問い合わせ自体が `IDLE_TIME` をリセットしてしまう）。

**断へ気付く道と繋ぎ直し**（ADR 0030）: **Oracle のエラーから `DbError` を作る場所は例外なく `errors.rs` の写し替え（`map_execute_error` / `map_oracle_error` / `map_permission_error`）を通す。**通さない経路はその経路だけが断に気付けず、フロント側の見張りには何も届かない。抜けは `src-tauri/tests/oracle_errors.rs` が数え上げで見張っており、`DbError::execute` を直に作ってよいのは `errors.rs`（写し替えそのもの）と `bind.rs`（データベースへ行っていない値の読み取り）だけである。**往復を起こさない覗きは入れてよい。** `Driver::prober()`（`Liveness::Disconnected` / `Unknown` の 2 値）は `oracle::Connection::status()` を読むだけでパケットを送らないため、`IDLE_TIME` は戻らない。**`Unknown` は生きている証明ではない**（回線が落ちただけの断は見えない）。覗きは `ConnectionPool::probe()` → `connection_health` コマンド →`useConnectionHealth`（30 秒ごと）で、断は `reportConnectionLost` から例外の経路と同じ見張りへ流す。**`connection_health` はデータベースへ往復しない。**見えない断のために、最後に往復できた時刻（`ConnectionPool::last_round_trip`、**進めるのは `見張る` が成功したときだけ**）が 5 分より古くなったらステータスバーへ「最終応答 12 分前」を添える（判定は `src/connection/freshness.ts` の純粋な関数）。**`connect` / `reconnect` / `disconnect` は古い接続の後片付けを待たない**（切れている相手のログオフは往復を試み、TCP が諦めるまで返らない）。**繋ぎ直しは押した瞬間に段階を `connecting` へ動かす**（待ってから動かすと、その間ボタンが押せるまま残り、押した回数だけプールが増える）。繋ぎ直せたら**スキーマツリーだけ取り直す**（他は正しいままか、もともと無い）。

**セッションとロック**（ADR 0017）: `V$SESSION` の一覧・ブロッキングの連鎖・他セッションの kill。入口はステータスバーの「接続中」のメニューで、`SessionsPanel` をオーバーレイで開く。取得はプールの `background_handle`（スキーマ取得と実行計画と同じ経路）で行い、**利用者の結果セットのカーソルには触れない**。連鎖の組み立ては `src-tauri/src/db/sessions.rs` の純粋な関数で、循環・一覧に居ない待たせ手・別インスタンスの 3 つを取りこぼさない。kill の関所は 3 つ（読み取り専用を弾く / 小槌自身の接続を弾く / 確認ダイアログ）。**前の 2 つは Rust 側に置く。** `ALTER SYSTEM` はデータを書かないため読み取り専用トランザクション（ADR 0004）では止まらず、ここだけはクライアント側で判定するしかない。権限が無いときは `DbErrorKind::Permission` で返し、**空の一覧を出さない。**

**オブジェクトのソース検索**（ADR 0021）: `ALL_SOURCE` を横断して「この文字列を含む処理はどれか」を探す。入口はステータスバーの「接続中」のメニューと `⇧⌘F` で、`SourceSearchPanel` をオーバーレイで開く。取得はプールの `background_handle`（セッション一覧・スキーマ取得・実行計画と同じ経路）で行い、**利用者の結果セットのカーソルには触れない**。`ALL_SOURCE` は数十万〜数百万行あるため、重さを 3 つで抑える — 検索語は 2 文字以上、所有者と種別の絞り込みを `like` より先に効かせる、`rownum` で当たり行に上限（既定 500）を置く。**上限のために `order by` を付けない**（付けると全件を拾ってから並べることになる）。並べ直しと束ねは `src-tauri/src/db/source.rs` の純粋な関数で、問い合わせの組み立ては `src-tauri/src/db/oracle/source.rs` の `build_search_sql` にある。**検索語は必ずバインド変数で渡し、`like` の `%` / `_` / `\` は打ち消す。** 探すのは PL/SQL の 7 種別で、**`PACKAGE BODY` と `TYPE BODY` を含む**（ツリーは出さないが、ソース検索では本体こそが探し先である。種別の列挙は `ObjectKind` とは別の `SourceKind` を使う）。**ビューの本文は対象外**（`ALL_VIEWS.TEXT` は `LONG` で `like` に掛けられない。理由は ADR 0021）。既定で大文字と小文字を区別せず、畳むのは**両辺とも Oracle 側**である。当たった行の前後は**選んだときに**読む（`source_context`、前後 5 行）。権限が無いときは `DbErrorKind::Permission` で返し、**空の結果を出さない。** 打ち切ったときも**黙って切り詰めない。**

**自動アップデート**（ADR 0042）: 確認先は `https://github.com/taiga533/koduchi/releases/latest/download/latest.json` の 1 つで（`tauri.conf.json` の `plugins.updater`）、**公開済みの最新リリース**だけを指す。下書きは指さないので、公開ボタンが配布の最後の関所のままである。起動時の確認は**最初のウィンドウ（`main`）だけ**で走り、`tauri dev` では走らない（`shouldCheckOnLaunch`）。最新のときも失敗したときも黙っている。手の入口はアプリメニューの「アップデートを確認…」とパレットで、コマンドの表の `check-update` を通る。見つけたら尋ね、承諾されてから取得・入れ替え・再起動まで続ける。**`AppHandle::restart` を直に呼ばない**（未コミットの関所を飛ばす）。`restart_for_update` が再起動を**予約**して全ウィンドウへ閉じる要求を送り、終了と同じ道を通って最後のウィンドウが閉じたときに `lib.rs` の受け手が起ち上げ直す（判断は `updater.rs` の `decide_exit`）。ウィンドウを閉じる関所は `src/mediator/update.ts` の `confirmWindowClose` で、**断られたら予約を取り消す**（残すと後の普通の終了で起ち上がり直す）。段階は `src/stores/update.ts`、遷移は `docs/state/update.d2`。更新用の `.app.tar.gz` は別に公証へ出さず、dmg の中身と cdhash が一致することをリリースの CI が確かめる。**`bundle.createUpdaterArtifacts` を `tauri.conf.json` に書かない**（手元の `tauri build` が署名鍵を要求する。CI が `--config` で足す）。minisign の秘密鍵は secret（`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD`）にだけ置き、**失うと配った版はもう自動で更新できない**。公開鍵と組であることはリリースの CI が添付の前に確かめる。

**CSV の書き出し**: 行はフロントエンドに溜めない。カーソルから取り出したかたまりを `csv_append` で順に Rust へ渡し、書き終えたら `csv_finish` を呼ぶ（`src/csv/exportCsv.ts`）。中止と失敗では `csv_abort` で書きかけのファイルごと消す。数十万行を 1 度の IPC に載せないための形である。

**書体**: PlemolJP v3.1.0（等幅版、SIL OFL 1.1）を `src/assets/fonts/` に同梱し、`src/theme/fonts.css` で登録している。半角と全角の幅比が 1:2 なので、日本語を含むデータでも結果テーブルの桁が揃う。データベースの内容は任意の文字を含みうるため**サブセット化はしない**。収録ウェイトは 400 / 500 / 600 / 700 の 4 つ。

**ライセンス**（ADR 0029）: 小槌は **PolyForm Noncommercial License 1.0.0 + 追加許諾**で提供する。**正文は英語の `LICENSE`** で、`LICENSE.ja.md` は効力の無い参考訳である。**PolyForm の条文には手を入れない。**条件を変えるときは追加許諾の側に足す。追加許諾の要は 2 つで、**バージョン 1.0.0 未満は商用・非商用を問わず無償**、ただし**その許諾は実行と使用に限り配布を含まない**（PolyForm の `Use` は配布を含む定義なので、条文で明示的に外している）。**既に公開した 1.0.0 未満のリリースについてこの許諾は撤回しない。**1.0.0 以降の条件はまだ決めていない。

**貢献の受け入れ**（ADR 0029）: PR を受ける。条件は `CONTRIBUTING.md` にあり、要は**ライセンサーへの再ライセンス権**（有償の商用条件を含む任意の条件で配布できる）である。**DCO だけでは足りない**（元のライセンスでの提供を言うだけで、別の条件で提供する権利を与えない）。この条項が無いまま PR を取り込むと、追加許諾第 2 条で予告した道が塞がる。同意の証跡は全コミットの `Signed-off-by`。

**第三者の著作権表示**（ADR 0029）: `THIRD-PARTY-NOTICES.md` は `bun run notices` の**生成物**であり手で編集しない。npm は `package.json` の `dependencies` の閉包、Rust は `cargo tree -e normal` から拾う。書体のように依存関係の外で同梱するものは `scripts/generate-third-party-notices.ts` の `ASSETS` に足す。**全文が拾えなかったものは黙って落とさず、その旨を書く。** `LICENSE` と併せて `tauri.conf.json` の `bundle.resources` で `.app` へ同梱し、指定と実在を `src-tauri/tests/notices.rs` が見張る（外れても手元の `tauri dev` では気づけない）。

## 制約

- TypeScript は `strict` に加えて `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- アプリ識別子は `ninja.taiga533.koduchi`（`tauri.conf.json`）。
- バージョンの実体は `package.json` と `src-tauri/Cargo.toml` の 2 箇所だけ。上げるときは `bun run version:bump <版>` で `Cargo.lock` と併せて 3 つを 1 回で書き換える（手で揃えない）。`tauri.conf.json` の `version` は `"../package.json"` を参照しているので触らない。タグとの一致は `scripts/check-release-tag.sh` が見張る（ADR 0011）。
- 準拠法は日本法、第一審の専属的合意管轄は横浜地方裁判所小田原支部（`LICENSE` の追加許諾第 4 条）。
- Rust の版は `rust-toolchain.toml` で `1.98.0` に固定してある。GitHub Actions は commit SHA でピン留めする（更新は Dependabot が PR を出す）。
- 対応 OS は macOS 26.2 以降（`tauri.conf.json` の `minimumSystemVersion`）。リリースの dmg は **`macos-26` ランナーの上で** Xcode 26.3 で作る（`release.yml` の `runs-on` と `DEVELOPER_DIR`）。**この 3 つは組であり、1 つだけを動かさない**（ADR 0011）。Liquid Glass の `.icon` を焼く `actool` はホスト OS も 26 を要求し、`macos-15` では Xcode 26.3 を選んでも落ちる。
