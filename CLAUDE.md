# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

`koduchi` は Tauri v2 + React 19 + TypeScript + Vite のデスクトップアプリ。現状は `create-tauri-app` のテンプレートほぼそのままの初期状態で、独自ロジックはまだ入っていない。

## コマンド

パッケージマネージャは **bun**（`bun.lock` が存在。`tauri.conf.json` の `beforeDevCommand` / `beforeBuildCommand` も `bun run` を呼ぶ）。

```bash
bun install              # 依存関係のインストール
bun run tauri dev        # デスクトップアプリを開発モードで起動（Vite + Rust を同時に立ち上げる）
bun run tauri build      # 配布用バイナリのビルド
bun run dev              # フロントエンドのみ Vite で起動（localhost:1420）
bun run build            # tsc による型チェック + Vite ビルド（型エラーはここで検出）
cargo check              # src-tauri/ 配下で Rust 側の型チェック
cargo fmt                # src-tauri/ 配下で Rust コードの整形
```

リンタ・テストランナーは未導入。テストを追加する場合は、フロントエンド側（Vitest 等）と Rust 側（`cargo test`）を別々に用意する必要がある。

## アーキテクチャ

フロントエンド（`src/`）と Rust バックエンド（`src-tauri/`）が Tauri の IPC で繋がる2層構成。

**Rust コマンドの追加手順**（この3点セットが揃わないと呼び出せない）:

1. `src-tauri/src/lib.rs` に `#[tauri::command]` を付けた関数を定義する
2. 同ファイル `run()` 内の `tauri::generate_handler![]` にその関数名を登録する
3. フロントエンドから `invoke("関数名", { 引数 })`（`@tauri-apps/api/core`）で呼ぶ。引数名は Rust 側の仮引数名と一致させる（JS 側は camelCase、Rust 側は snake_case で自動変換される）

`src-tauri/src/main.rs` は `koduchi_lib::run()` を呼ぶだけの薄いエントリポイント。実装は必ず `lib.rs` 側に置く（モバイル対応のため lib/bin が分離されている）。

**権限（capabilities）**: Tauri v2 では API ごとに明示的な許可が必要。プラグインや core API を新たに使う場合は `src-tauri/capabilities/default.json` の `permissions` に追加する。追加を忘れると実行時に権限エラーで失敗する。

**ポート 1420 固定**: Vite は `strictPort: true` で 1420 に固定されており、Tauri がこの URL を読み込む。ポートを変える場合は `vite.config.ts` と `tauri.conf.json` の `devUrl` の両方を更新する。

## 制約

- TypeScript は `strict` に加えて `noUnusedLocals` / `noUnusedParameters` が有効。未使用の変数・引数はビルドエラーになる。
- アプリ識別子は `ninja.taiga533.koduchi`（`tauri.conf.json`）。
