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

**設定ファイルの置き場所**: すべて `app_config_dir()`（`~/Library/Application Support/ninja.taiga533.koduchi/`）の下に置く。`instant_client.toml`（ADR 0001）/ `connections.toml`（ADR 0004・0013）/ `settings.toml`（テーマ・エディタの文字の大きさ・CSV の書式）/ `history.sqlite3`（ADR 0005）の 4 つ。**パスワードはどれにも書かない。** キーチェーンのサービス名は `ninja.taiga533.koduchi`、アカウント名は接続の一意 ID である。接続を削除したらキーチェーンのエントリも必ず消す。

**権限（capabilities）**: Tauri v2 では API ごとに明示的な許可が必要。プラグインや core API を新たに使う場合は `src-tauri/capabilities/default.json` の `permissions` に追加する。追加を忘れると実行時に権限エラーで失敗する。動的に作るウィンドウ（ADR 0009）は `connection-` で始まるラベルを持ち、capability の `windows` がその前置きで受けている。ラベルの決め方を変えるときは両方を直す。

**ポート 1420 固定**: Vite は `strictPort: true` で 1420 に固定されており、Tauri がこの URL を読み込む。ポートを変える場合は `vite.config.ts` と `tauri.conf.json` の `devUrl` の両方を更新する。

**デザイントークンとテーマ**（ADR 0008）: 色は `src/theme/tokens.css` の CSS 変数に集約してある。`uno.config.ts` の `theme.colors` はその変数を参照するだけなので、UnoCSS のクラス（`bg-panel` / `text-fg3` など）を使えば自動的にテーマへ追従する。**色の値をコンポーネントへ直接書かない。** テーマの切替はルート要素の `data-theme` 属性 1 つで行う（属性なし = システム追従）。罫線の有無と行の高さは `data-grid-lines` / `data-row-height`、エディタの文字の大きさは `data-editor-font-size` で切り替える。属性の付け外しは `src/theme/appearance.ts` が担う。**既定値のときは属性を付けない**（`tokens.css` は属性が無い状態を既定として書いてあり、付け外しの結果が設定値と一対一で対応する）。文字の大きさは 4 段階（`small` / `medium` / `large` / `xlarge`）の決め打ちで、値は `--fs-editor` が持つ。**結果テーブルの文字はこの設定では変わらない**（固定の行の高さと `columnSizing.ts` の見積りが追随しないため）。`settings.toml` を読む Rust 側（`commands/config.rs`）の項目には**すべて `#[serde(default)]` を付ける**。付け忘れると、その項目を持たない古いファイルで表ごと読み取りが失敗し、テーマも行の高さもまとめて既定へ戻る。

**信号機の位置**（ADR 0009）: `trafficLightPosition` は見た目上のオフセットではない。tao はタイトルバーのコンテナの高さを `ボタンの高さ + y` に変え、ボタンの `origin.y`（実測 9）は据え置く。macOS は左下原点なので、結果として**ボタンの中心はウィンドウ上端から `y - 2` の位置**に来る。縦中央に置く値は `y = タイトルバーの高さ / 2 + 2`。導出と実測値は `src/components/titlebar/geometry.ts` にあり、`tauri.conf.json` との整合はテストで見張っている。**この値を目分量で調整しない。**

**アイコン**: `lucide-react` を使う。`✕` / `＋` / `⌕` のような文字の記号を直接置かない（字形が環境任せになり、字送りの都合で小さく潰れる）。大きさは `size` で 12〜15px の範囲に収め、色は `className` の `text-fg5` などトークン側で決める。

**補完**（ADR 0013）: 識別子の候補は `src/components/editor/sqlCompletion.ts` の自前の補完ソースが出す。`@codemirror/lang-sql` の `schemaCompletionSource` は**使わない**（階層の解決が大文字小文字を区別し、候補を必ず引用符付きで挿入するため）。名前は `catalog.ts` が大文字へ畳んだ鍵で引き、挿入する綴りは `identifiers.ts` が決める。**引用符は必要なときだけ付け、付けるときは綴りを変えない。** 方言は `dialect.ts` の `koduchiOracleDialect`（`PLSQL` から `doubleQuotedStrings` だけを落としたもの）で、補完ソースは**この方言の `language`** へ足す（`PLSQL.language` へ足しても繋がらない）。挿入する綴りは接続ごとの設定で `connections.toml` に持つ。**「今どの表を相手にしているか」を読むのは `sqlScope.ts`** で、`FROM` / `JOIN` / `,` に加えて `UPDATE` / `INSERT INTO` / `DELETE` / `MERGE` の対象表と、`WITH` の共通表式・`FROM` の副問い合わせを見る。**出力の列名が決まらない項目は落とす**（`SELECT a + b` のような名前の付かない式に名前を作って出すと、実行して初めて `ORA-00904` になる候補を勧めることになる）。補完は打鍵の途中、つまり構文として壊れた文の上で走る。**書きかけの文で候補が消えたり例外が飛んだりしないことをテストで見張る。**

**スキーマツリーの種別**（ADR 0014）: 種別は 12 個（`ObjectKind`）。列挙元は `ALL_OBJECTS` の 10 種別に加え、索引が `ALL_INDEXES`（`GENERATED = 'N'` のみ）、DB link が `ALL_DB_LINKS` である。**所有者が `PUBLIC` のものは列挙しない**（公開シノニムだけで数万件になる）。**制約はツリーに出さない**（理由は ADR 0014。置き場所はテーブル定義ビューであり、ADR 0019 で実装した）。ツリーはスキーマとオブジェクトの間に**種別の束**を 1 段挟む。束の並びは `OBJECT_KIND_ORDER`、鍵は `kindGroupKey`（`KODUCHI.#table`）。絞り込み中だけ束は既定で開く。種別ごとの表示可否は `SchemaFilter.kinds` として `connections.toml` に持ち、**落とした種別は問い合わせにも行かない**。補完のカタログには索引・トリガー・DB link を流さない（`catalog.ts` の `isCompletable`）。

**テーブル定義タブと DDL**（ADR 0019・0022）: ツリーの**右クリックのメニューの「定義を開く」**（またはツリーの中の `⌘D`）から、**エディタのタブ帯に定義タブとして**開く（ADR 0022。オーバーレイに出す作りと行の右の「定義」ボタンは 0022 で覆した。結果ペインの動的タブにはしない点は 0019 のまま）。**定義タブを選んでいる間はエディタも結果ペインも出さず、本体をまるごと `TableDefinitionPanel` が使う。**内訳は**列 / 制約 / 索引 / DDL** の 4 つで並びは固定。取得は 2 つのコマンドに分かれ、`object_definition`（列・制約・索引）は開いた時点で、`object_ddl`（`DBMS_METADATA.GET_DDL`）は **DDL の内訳を開いたときに初めて**走る。GET_DDL の権限が無いというだけで列も制約も見られなくなってはいけないためである。どちらもプールの `background_handle` で取り、利用者のカーソルには触れない（ADR 0003）。**GET_DDL の型名は `ALL_OBJECTS.OBJECT_TYPE` の綴りと違う**（`MATERIALIZED_VIEW` / `DB_LINK` とアンダースコアで繋ぐ）。`ObjectKind::ddl_object_type()` から引き、`object_type()` と取り違えない（`ORA-31600` になる）。**パッケージは仕様と本体を 2 度取る**（`PACKAGE` と `PACKAGE_BODY`）。整形は `SET_TRANSFORM_PARAM` で `SQLTERMINATOR` / `PRETTY` を真、`SEGMENT_ATTRIBUTES` / `STORAGE` を偽にする。**制約はツリーではなくここに出す**（ADR 0014 からの申し送り）。外部キーは参照先の表と列まで出し、`NOT NULL` を言っているだけの検査制約は落とす（`is_not_null_check`）。**索引は自動生成のものも出す。** ツリー（ADR 0014）と逆だが、主キーの索引が見えないと「この列で引けるのか」が分からない。列は段階 2 のキャッシュを使い回さず引き直す（読み込み中のスキーマで 0 件に見えないため）。絞り込みは列・制約・索引の 3 タブに効き、判定は `src/components/definition/definitionSearch.ts` の純粋な関数に寄せてある。**ツリーの入口は右クリックの「定義を開く」1 つだけで、マウス操作の割り振りは足していない**（ADR 0022）。**4 つの内訳はどれもコピーできる。**入口は内訳のタブの並びの右端の「コピー」1 つで、写すのは**今開いている内訳の、今画面に出ているもの**である。絞り込み中はボタンの文字が「絞り込んだぶんをコピー」に変わる（押した後の一言だけでは、欠けたものを貼ってから気づく）。表は見出し付きのタブ区切り、DDL は `GET_DDL` の出力を**そのまま**渡す（見出しも註釈も足さない）。組み立ては `src/components/definition/definitionCopy.ts` の純粋な関数。

**エディタのタブの 2 種類**（ADR 0022）: タブ帯（`TabBar.tsx`）には **SQL タブと定義タブ**が並ぶ。型は `src/stores/tab.ts` の `EditorTab`（`kind` で判別する union）で、**並びは 1 本の配列のまま**である。並び順・選択・閉じるは種類を知らずに書ける。種類による振り分けは `src/stores/tabKinds.ts` の純粋な関数（`isSqlTab` / `isDirty` / `openDefinitionTab` / `toSessionTabs` / `fromSessionTabs`）に寄せてある。**「今のタブの SQL」を要る操作はすべて `selectActiveSqlTab` を通す**（実行・`⌘S` / `⇧⌘S` / `⌥⌘S` / `⌘E`）。定義タブでは何も起きない。**定義タブはセッションに保存しない**（定義は接続に属し、小槌は接続を復元しないため。Rust 側の `session_tab` / `session_state` には手を入れていない）。**同じオブジェクトの定義タブは 2 枚開かない。**定義の中身は `definition` ストアが**タブの ID を鍵にして**持ち、タブを閉じたら `drop(tabId)` で捨てる。`esc` では閉じない（タブは重なっていない。閉じるのは `⌘W`）。

**スキーマツリーからの操作**（ADR 0020・0022）: ツリーの行から名前をエディタへ入れられる。**挿入する綴りと引用符は `identifiers.ts` の `styleIdentifier` が決める**（ADR 0013）。自前で書き直さないこと。文字列の組み立ては `src/components/editor/insertion.ts` の純粋な関数（`qualifiedIdentifier` / `withLeadingSpace` / `selectAllStatement`）に寄せてある。オブジェクトは `TreeRow` の `owner`（ADR 0019 と共用）で**スキーマ修飾**し、**列は修飾しない**。挿入は `SqlEditor` の `insertAtCursor`（`SqlEditorHandle`）越しに CodeMirror へ差分として渡す。タブの内容を丸ごと差し替えるとカーソルが末尾へ飛ぶ。**挿入しても焦点はエディタへ移さない。**右クリックのメニューは「名前をコピー」「エディタへ挿入」「`SELECT` を開く」「定義を開く」の 4 つ。3 つめは列を持つ種別だけ、4 つめ（ADR 0022）はオブジェクトの行で繋がっているときだけ出す。**`SELECT` は新しいタブに入れるだけで実行しない**（結果セットのカーソルは接続 1 本につき高々 1 つで、実行すると別タブの結果が閉じられる。ADR 0003）。クリップボードは `src/api/clipboard.ts` 越しに呼ぶ。

マウス操作の割り振りは次のとおり。**この表がスキーマツリーの操作の持ち主である。**入口を足すときはここに 1 行を足す。

| 操作               | 起きること                                                      |
| ------------------ | --------------------------------------------------------------- |
| 行を単クリック     | 開閉する（開けない行では何も起きない）                          |
| 行をダブルクリック | 名前をエディタのカーソル位置へ挿入する                          |
| 行を右クリック     | コピー・挿入・`SELECT` を開く・定義を開く（ADR 0022）のメニュー |

ダブルクリックは 1 回目と 2 回目の押し下げでそれぞれ `click` が起き、開閉が 2 度切り替わって元へ戻る。**`event.detail` を見て打ち消す細工は入れない**（結果テーブルの「ダブルクリックは 1 回目の押し下げで選択も起こる」と同じ扱い）。**行の右に押しどころは無い**（「定義」のボタンと `data-row-action` の仕組みは ADR 0022 で消した）。足すときは `data-row-action` を付けてダブルクリックの挿入から外すこと（作法は ADR 0020 に残っている）。ツリーの中でだけ効くキーは `↑` / `↓` / `→` / `←` と `⌥⏎`（挿入）/ `⌘C`（コピー）/ `⌘D`（定義を開く。ADR 0022）で、`SchemaTree` の `keydown` に置く。仮想スクロールのため焦点は 1 行だけが持ち（roving tabindex）、行が描かれるまで待ってから当てる。

**タブ帯の並べ替えと閉じる**（ADR 0023）: 未保存の `●` 印は**名前の左**、閉じるボタンは**常に右**に出す。**印とボタンを排他にしない**（未保存のタブが閉じられなくなる。`dirty` を持たないタブが並びに混ざっても破綻する）。印が無いときも 7px の場所は空けておき、打ち始めた瞬間に幅が動かないようにする。**タブを閉じる関所は `App.tsx` の `closeTabAndRelease` 1 つ**で、`✕` も `⌘W` もそこを通る。`dirty` かつ本文が空白だけでないときだけ確認を挟み、判定は `src/components/editor/closing.ts` の `needsCloseConfirmation`、確認そのものは `setCloseTabDialog` で差し替えられる（`transaction/pendingChanges.ts` と同じ形）。並べ替えは `Splitter` と同じ Pointer Events（`setPointerCapture`・`document.body` の `user-select: none`）で行い、**HTML5 の drag and drop API も `dnd-kit` のようなライブラリも使わない**。落とす位置の計算は `src/components/editor/tabOrder.ts` の純粋な関数（`moveItem` / `dropIndex`）に寄せてある。隣のタブの**中心**を越えたときに入れ替え、ドラッグ中に随時動かす。閉じるボタンには `data-tab-action` を付け、そこから始めた動きでは掴まない（ツリーの `data-row-action` と同じ形）。並びは `session_tab.position` としてそのまま保存されるため **Rust 側に手は要らない**。タブは枚数が増えると縮み、下限（`tabSizing.ts`）まで縮んだら帯が横へスクロールする。下限は `●` 印・種別アイコン・閉じるボタンが**どこまで縮んでも見えている**幅として決まる。名前は `…` で省き、`title` で読める。`＋` はスクロールする器の外に置く。選んだタブが帯の外に居るときは必要な最小限だけ送る（`tabScroll.ts` の `revealOffset`）。掴んだまま端へ持っていくと帯が送られる（`autoScrollStep`）。**`tabOrder.ts` の `dropIndex` はスクロールしても手を入れなくてよい**（`getBoundingClientRect()` と `clientX` は同じ座標系で一緒にずれる）。**タブを別ウィンドウへ引き剥がす操作は作らない**（ADR README「ペインの大きさ」節の決定）。

**SQL の整形**（ADR 0024）: `⇧⌥F` で整形する。**選択範囲があればその範囲だけ、なければタブ全体**を整形する。整形は `sql-formatter` 15.8.2 がフロントエンドで行い、**Rust 側には置かない**（接続していなくても使えるべきだからである）。方言は `plsql` 固定で、接続の有無や接続種別では切り替えない。**整形が変えてよいのは空白の置き方だけである。**入力と出力を `src/sql/tokens.ts` の字句の並びで照合し、1 つでも食い違えば**整形を取りやめて本文に触れない**（`sql-formatter` 15.8.2 は改行を含む `q'[...]'` を `q` と `'[...]'` に割る）。走査の下ごしらえは `src/sql/scan.ts` が持ち、**文の切り出し（`statements.ts`）と同じ判定を通す**。綴りは畳まない（`keywordCase` などはすべて `preserve`。ADR 0013 と同じ考えであり、照合の前提でもある）。**書式は決め打ちで、設定の項目は作らない。**整形できなかったときは `execution` ストアの `noteFormatFailure` でメッセージタブへ出し、そこへ切り替える。書き換えは前後の変わらない部分を削った**差分**として CodeMirror へ渡す（`src/components/editor/formatting.ts` の `unchangedEnds`）。丸ごと置き換えるとカーソルが末尾へ飛ぶ。選択範囲のときは 2 行目以降を `selectionIndent` の下げ幅へ揃える。入口は `⇧⌥F` とコマンドパレットの「SQL を整形」の 2 つで、どちらも `SqlEditorHandle.formatDocument` を通る。**定義タブではエディタそのものが描かれないため何も起きない**（ADR 0022。判定は書き足さない）。

**キーバインドの置き場所**: エディタの中でしか意味を持たない `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / `⌘.` と検索の `⌘F` / `⌘G` / `⇧⌘G` / `⌥⌘F` と整形の `⇧⌥F`（ADR 0024）は CodeMirror の keymap に、それ以外（`⌘E` / `⇧⌘E` / `⌥⌘S` / `⌥⌘C` / `⌥⌘R` / `⌘S` / `⇧⌘S` / `⌘O` / `⌘T` / `⌘W` / `⌃⌘N` / `⌘K` / `⇧⌘F`）は `App.tsx` の `keydown` に置く。後者は `event.defaultPrevented` を見て、エディタが既に処理したものを二重に扱わない。修飾の重なる `⌘S` / `⇧⌘S` / `⌥⌘S` は、絞りの強い枝から先に見る。結果テーブルの中でしか意味を持たない `⌘C` / `⇧⌘C` / `⌘A` と `⌘F` / `⌘G`（表の中の検索。ADR 0027）は `ResultTable` の `keydown` に置き、スキーマツリーの中でしか意味を持たない `↑` / `↓` / `→` / `←` / `⌥⏎` / `⌘C` / `⌘D` は `SchemaTree` の `keydown` に置く（ADR 0020・0022）。タブ帯の中でしか意味を持たない `⌥←` / `⌥→`（タブの並べ替え）は `TabBar` の `keydown` に置く（ADR 0023）。`⌘I`（Ask AI）は**割り当てない**（将来のための予約）。`⌘K` はコマンドパレット（ADR 0018）、`⇧⌘F` はオブジェクトのソース検索（ADR 0021）に割り当て済みである。`⌘D`（定義タブを開く）はツリーの中だけで効く（ADR 0022）。`⇧⌘F` は CodeMirror の `⌘F` とは修飾が違うため食い合わない。`⇧⌥F`（SQL の整形、ADR 0024）だけは keymap へ**キーの名前で登録できない**。macOS では `⌥` を伴う打鍵で文字そのものが変わる（US でも JIS でも `Ï`）ため、keymap の `any` から `event.code === 'KeyF'` で拾う（`formatting.ts` の `isFormatShortcut`）。

**変換中の打鍵（IME）**（ADR 0025）: 日本語の変換確定の `⏎` は「決定」ではない。**修飾キーの付かない打鍵（`⏎` / `esc` / `↑` / `↓`）を扱うハンドラは、先頭で `src/input/ime.ts` の `isComposingKey(event)` を見て、真なら何もせずに戻る。`<form>` には `onKeyDown={blockComposingSubmit}` を付ける**（中の欄が日本語を打つ欄かで判断しない）。判定は **`isComposing` と `keyCode === 229` の両方**を見る。片方だけでは確定の打鍵を取りこぼす（変換を確定する `⏎` は `isComposing` が偽で届く。実測は ADR 0025 の「1-2」）。`⌘` や `⌥` を必須にする打鍵には要らない。**CodeMirror の本文にも足さない**（`@codemirror/view` が既に捨てている）。**`⌘F` の検索パネルだけが例外**で、`search.tsx` の捕捉相の関所が `keyup` と `keydown` を止める（ADR 0025 の「1-3」）。**入力欄や `<form>` を足したら ADR 0025 の監査の表に 1 行を足す。**

**結果テーブルのコピー**: セル選択は `ResultTable` の中に閉じた状態で持つ（`ui` ストアへ置くと打鍵ごとにアプリ全体が描き直る）。タブを切り替えたときは `ResultPane` が `key={tabId}` で作り直し、選択を捨てる。範囲の判定とコピー文字列の組み立ては `src/components/results/selection.ts` の純粋な関数に寄せてある。クリップボードは `src/api/clipboard.ts` 越しに呼ぶ（テストで差し替えるため）。

**結果テーブルの列幅と詳細**: 列幅は `ui` ストアの `resultColumnWidths`（タブ ID → 列名 → 幅）に置く。選択と違って再実行やタブ切替をまたいで残す値だからである。幅の勘定は `src/components/results/columnSizing.ts` の純粋な関数に寄せてあり、内容合わせは実寸を測らず PlemolJP の送り幅（半角 0.528em、全角はその 2 倍）から見積もる。セルの詳細は `CellDetailPanel.tsx`。マウス操作の割り振りは `ResultTable.tsx` 冒頭の表に書いてある。**列のソートは実装しない**（理由は `adr/README.md`）。**64KB を超えて切り詰められた `CLOB`** は `Cell.truncated` で届くので、詳細パネルでは本文の上に注意書きを出し、文字数にも「先頭 64 KB のみ」を添える（ADR 0021 の「黙って切り詰めない」）。**本文とクリップボードには印を混ぜない。**

**結果テーブルの検索**（ADR 0027）: `⌘F` で探し、`⌘G` で次の当たりへ移る。**当て先は `displayText(cell)` であって `Cell.text` ではない**（画面に見えている文字列を探す。NULL のセルは `null` と打てば拾える）。**探せるのは取得済みの行だけである**ため、件数だけを出さず、カーソルが尽きるまでは**走査した行数を必ず添える**。「3 件」とだけ書いてはならない。切り詰められた値を走査したときはその旨も添える。判定は `src/components/results/resultSearch.ts` の純粋な関数、状態は `ResultTable` の中に閉じる。ソートを実装しない決定には触れない（検索は順序を偽らない）。

**保存済みクエリとコマンドパレット**（ADR 0018）: 保存済みクエリは `history.sqlite3` の `saved_query` 表に置く。履歴と同じく全接続で 1 つの表であり、接続名を添えてスコープを切り替える（**既定は「全接続」**。履歴と逆である）。**バインド変数の値は保存しない。** パレット（`⌘K`）が探すのはコマンド / スキーマ / 保存済みクエリ / 履歴の 4 種で、**見出しの並びは固定**、当たり判定と順序は `src/components/palette/paletteSearch.ts` の純粋な関数に寄せてある。拾い方は大小を区別しない**部分一致**であり、あいまい一致は使わない。列はパレットの候補にしない（補完の領分、ADR 0013）。

**トランザクション**（ADR 0012）: 自動コミットは接続ごとの項目で、既定はオフ（手動コミット）。未コミットかどうかは実行のたびに `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` を読んで決める。**クライアント側で DML を数えない。** コミット / ロールバックはプールの全接続へ配る。未コミットのまま接続を手放させないための関所は `App.tsx` の `resolvePendingTransaction` にあり、ウィンドウを閉じる経路（`onWindowCloseRequested`）・アプリの終了（`lib.rs` の `RunEvent::ExitRequested`）・切断（`disconnectAndReset`）のすべてがここを通る。**接続が切れているときは素通しする**（届かないコミットを尋ねて袋小路へ入れない。ADR 0026）。

**接続断**（ADR 0026）: サーバ側で切れたこと（`ORA-02396` / `ORA-03113` など）は `DbErrorKind::ConnectionLost` で表す。**`Closed`（小槌が自分で閉じた）とも `Connect`（繋ぎ直しても駄目）とも別物**であり、取り違えると再接続の道が出ない。番号からの写し替えは `src-tauri/src/db/oracle/errors.rs` の `classify` に集め、**接続断を権限より先に見る**（切れた接続へ辞書ビューを引くと `ORA-03113` が返り、それを「権限が無い」と読ませてはならない）。**`DbError::execute` を直に作らず `map_execute_error` を通す**。通さない経路はその経路だけが断に気付けない。**1 本の断はプールごとの断として扱い**（`pool.rs` の `lost`）、印が立った後は往復せずその場で返す。フロント側は `src/api/` の窓口を丸ごと包む `src/connection/lost.ts` の見張り 1 つで気付き、`App.tsx` が `connection` / `execution` ストアへ順に配る（切断の後片付けと同じ形）。**繋ぎ直しは自動で行わない**（未コミットの変更はサーバ側でロールバック済みであり、繋ぎ直した接続は別のセッションである）。切れた時点で「未コミット」の表示を降ろし、**降ろしたことをメッセージタブへ残す**。**報せるのは段階が実際に変わったときだけ**（`markLost` の戻り値で見る）で、切れた後に触るたびに同じ行を積まない。繋ぎ直しの失敗は押した回数だけ残す。**定期的な生存確認はしない**（その問い合わせ自体が `IDLE_TIME` をリセットしてしまう）。

**セッションとロック**（ADR 0017）: `V$SESSION` の一覧・ブロッキングの連鎖・他セッションの kill。入口はステータスバーの「接続中」のメニューで、`SessionsPanel` をオーバーレイで開く。取得はプールの `background_handle`（スキーマ取得と実行計画と同じ経路）で行い、**利用者の結果セットのカーソルには触れない**。連鎖の組み立ては `src-tauri/src/db/sessions.rs` の純粋な関数で、循環・一覧に居ない待たせ手・別インスタンスの 3 つを取りこぼさない。kill の関所は 3 つ（読み取り専用を弾く / 小槌自身の接続を弾く / 確認ダイアログ）。**前の 2 つは Rust 側に置く。** `ALTER SYSTEM` はデータを書かないため読み取り専用トランザクション（ADR 0004）では止まらず、ここだけはクライアント側で判定するしかない。権限が無いときは `DbErrorKind::Permission` で返し、**空の一覧を出さない。**

**オブジェクトのソース検索**（ADR 0021）: `ALL_SOURCE` を横断して「この文字列を含む処理はどれか」を探す。入口はステータスバーの「接続中」のメニューと `⇧⌘F` で、`SourceSearchPanel` をオーバーレイで開く。取得はプールの `background_handle`（セッション一覧・スキーマ取得・実行計画と同じ経路）で行い、**利用者の結果セットのカーソルには触れない**。`ALL_SOURCE` は数十万〜数百万行あるため、重さを 3 つで抑える — 検索語は 2 文字以上、所有者と種別の絞り込みを `like` より先に効かせる、`rownum` で当たり行に上限（既定 500）を置く。**上限のために `order by` を付けない**（付けると全件を拾ってから並べることになる）。並べ直しと束ねは `src-tauri/src/db/source.rs` の純粋な関数で、問い合わせの組み立ては `src-tauri/src/db/oracle/source.rs` の `build_search_sql` にある。**検索語は必ずバインド変数で渡し、`like` の `%` / `_` / `\` は打ち消す。** 探すのは PL/SQL の 7 種別で、**`PACKAGE BODY` と `TYPE BODY` を含む**（ツリーは出さないが、ソース検索では本体こそが探し先である。種別の列挙は `ObjectKind` とは別の `SourceKind` を使う）。**ビューの本文は対象外**（`ALL_VIEWS.TEXT` は `LONG` で `like` に掛けられない。理由は ADR 0021）。既定で大文字と小文字を区別せず、畳むのは**両辺とも Oracle 側**である。当たった行の前後は**選んだときに**読む（`source_context`、前後 5 行）。権限が無いときは `DbErrorKind::Permission` で返し、**空の結果を出さない。** 打ち切ったときも**黙って切り詰めない。**

**CSV の書き出し**: 行はフロントエンドに溜めない。カーソルから取り出したかたまりを `csv_append` で順に Rust へ渡し、書き終えたら `csv_finish` を呼ぶ（`src/csv/exportCsv.ts`）。中止と失敗では `csv_abort` で書きかけのファイルごと消す。数十万行を 1 度の IPC に載せないための形である。

**書体**: PlemolJP v3.1.0（等幅版、SIL OFL 1.1）を `src/assets/fonts/` に同梱し、`src/theme/fonts.css` で登録している。半角と全角の幅比が 1:2 なので、日本語を含むデータでも結果テーブルの桁が揃う。データベースの内容は任意の文字を含みうるため**サブセット化はしない**。収録ウェイトは 400 / 500 / 600 / 700 の 4 つ。

## 制約

- TypeScript は `strict` に加えて `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- アプリ識別子は `ninja.taiga533.koduchi`（`tauri.conf.json`）。
- バージョンの実体は `package.json` と `src-tauri/Cargo.toml` の 2 箇所だけ。`tauri.conf.json` の `version` は `"../package.json"` を参照しているので触らない。タグとの一致は `scripts/check-release-tag.sh` が見張る（ADR 0011）。
- Rust の版は `rust-toolchain.toml` で `1.98.0` に固定してある。GitHub Actions は commit SHA でピン留めする（更新は Dependabot が PR を出す）。
- 対応 OS は macOS 26.2 以降（`tauri.conf.json` の `minimumSystemVersion`）。リリースの dmg は Xcode 26.3 で作る（`release.yml` の `DEVELOPER_DIR`）。**この 2 つは対であり、片方だけを動かさない**（ADR 0011）。
