#!/usr/bin/env bash
#
# bump-version.sh のテスト。
# 一時ディレクトリに 3 つのファイルを置いて動かす。
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly TARGET="${SCRIPT_DIR}/bump-version.sh"

failures=0

fail() {
  # 失敗したテストケースを記録して報告する。
  printf '  ✗ %s\n' "$*" >&2
  failures=$((failures + 1))
}

pass() {
  # 成功したテストケースを報告する。
  printf '  ✓ %s\n' "$*"
}

check() {
  # 条件が成り立てば成功、成り立たなければ失敗として報告する。
  local name="$1"
  shift
  if "$@"; then
    pass "${name}"
  else
    fail "${name}"
  fi
}

setup_repository() {
  # 版が 0.2.0 の 3 つのファイルを置き、その置き場所を標準出力に返す。
  # 依存関係の側にも version を置く（そちらを書き換えないことの確認用）。
  local root
  root="$(mktemp -d)"
  mkdir -p "${root}/src-tauri"

  cat >"${root}/package.json" <<'JSON'
{
  "name": "koduchi",
  "private": true,
  "version": "0.2.0",
  "dependencies": {
    "react": "19.2.8"
  },
  "overrides": {
    "fake": {
      "version": "0.2.0"
    }
  }
}
JSON

  cat >"${root}/src-tauri/Cargo.toml" <<'TOML'
[package]
name = "koduchi"
version = "0.2.0"
edition = "2021"

[dependencies]
tauri = { version = "2.11.5", features = [] }

[workspace.package]
version = "0.2.0"
TOML

  cat >"${root}/src-tauri/Cargo.lock" <<'LOCK'
[[package]]
name = "keyring"
version = "0.2.0"

[[package]]
name = "koduchi"
version = "0.2.0"
dependencies = [
 "keyring",
]

[[package]]
name = "koduchi-helper"
version = "0.2.0"
LOCK

  printf '%s\n' "${root}"
}

koduchi_lock_version() {
  # Cargo.lock の小槌の項の版を返す。
  awk 'prev == "name = \"koduchi\"" { sub(/^version = "/, ""); sub(/"$/, ""); print } { prev = $0 }' "$1"
}

snapshot() {
  # 3 つのファイルの中身をまとめて返す。書き換えられていないことの比較に使う。
  local root="$1"
  cat "${root}/package.json" "${root}/src-tauri/Cargo.toml" "${root}/src-tauri/Cargo.lock"
}

test_3つのファイルの小槌の版だけを書き換える() {
  # Arrange
  local root
  root="$(setup_repository)"

  # Act
  "${TARGET}" 0.3.0 "${root}" >/dev/null

  # Assert
  check 'package.json のトップレベルの版を書き換える' \
    test "$(jq -r .version "${root}/package.json")" = '0.3.0'
  check 'package.json の入れ子の version は触らない' \
    test "$(jq -r .overrides.fake.version "${root}/package.json")" = '0.2.0'
  check 'Cargo.toml の [package] の版を書き換える' \
    grep -qx 'version = "0.3.0"' "${root}/src-tauri/Cargo.toml"
  check 'Cargo.toml の他の節の version は触らない' \
    test "$(grep -c '^version = "0.2.0"$' "${root}/src-tauri/Cargo.toml")" -eq 1
  check 'Cargo.lock の小槌の項を書き換える' \
    test "$(koduchi_lock_version "${root}/src-tauri/Cargo.lock")" = '0.3.0'
  check 'Cargo.lock の他の項は触らない' \
    test "$(grep -c '^version = "0.2.0"$' "${root}/src-tauri/Cargo.lock")" -eq 2
  rm -rf "${root}"
}

test_先頭のvを付けても通す() {
  # Arrange
  local root
  root="$(setup_repository)"

  # Act
  "${TARGET}" v0.3.0 "${root}" >/dev/null

  # Assert
  check '先頭の v を付けても通す' test "$(jq -r .version "${root}/package.json")" = '0.3.0'
  rm -rf "${root}"
}

test_版の形でなければ何も書き換えずに失敗する() {
  # Arrange
  local root
  root="$(setup_repository)"
  local before
  before="$(snapshot "${root}")"

  # Act
  local status=0
  "${TARGET}" 0.3 "${root}" >/dev/null 2>&1 || status=$?

  # Assert
  check '版の形でなければ失敗する' test "${status}" -ne 0
  check '版の形でなければ何も書き換えない' test "$(snapshot "${root}")" = "${before}"
  rm -rf "${root}"
}

test_今と同じ版なら失敗する() {
  # Arrange
  local root
  root="$(setup_repository)"

  # Act
  local status=0
  "${TARGET}" 0.2.0 "${root}" >/dev/null 2>&1 || status=$?

  # Assert
  check '今と同じ版なら失敗する' test "${status}" -ne 0
  rm -rf "${root}"
}

test_1つでも版の行が見つからなければどれも書き換えない() {
  # Arrange
  # Cargo.lock から小槌の項を消す。package.json と Cargo.toml は書き換えられる状態である。
  local root
  root="$(setup_repository)"
  sed -i.bak 's/^name = "koduchi"$/name = "renamed"/' "${root}/src-tauri/Cargo.lock"
  rm -f "${root}/src-tauri/Cargo.lock.bak"
  local before
  before="$(snapshot "${root}")"

  # Act
  local status=0
  "${TARGET}" 0.3.0 "${root}" >/dev/null 2>&1 || status=$?

  # Assert
  check '版の行が見つからなければ失敗する' test "${status}" -ne 0
  check '1 つでも見つからなければ他のファイルも書き換えない' \
    test "$(snapshot "${root}")" = "${before}"
  rm -rf "${root}"
}

test_ファイルが無ければ失敗する() {
  # Arrange
  local root
  root="$(setup_repository)"
  rm "${root}/src-tauri/Cargo.lock"

  # Act
  local status=0
  "${TARGET}" 0.3.0 "${root}" >/dev/null 2>&1 || status=$?

  # Assert
  check 'ファイルが無ければ失敗する' test "${status}" -ne 0
  rm -rf "${root}"
}

test_書き換えた後はcheck_release_tagの版の検査を通る() {
  # Arrange
  # 2 つのスクリプトが同じ行を見ていることを確かめる。タグの検査は main を要するため、
  # 一時的なリポジトリを作る。
  local root
  root="$(setup_repository)"
  git -C "${root}" init -q -b main
  "${TARGET}" 0.3.0 "${root}" >/dev/null
  git -C "${root}" add -A
  git -C "${root}" -c user.name=test -c user.email=test@example.com commit -q -m '0.3.0'

  # Act
  git -C "${root}" tag v0.3.0
  local status=0
  "${SCRIPT_DIR}/check-release-tag.sh" v0.3.0 "${root}" >/dev/null 2>&1 || status=$?

  # Assert
  check '書き換えた後は check-release-tag.sh を通る' test "${status}" -eq 0
  rm -rf "${root}"
}

printf '%s\n' "bump-version.sh"
test_3つのファイルの小槌の版だけを書き換える
test_先頭のvを付けても通す
test_版の形でなければ何も書き換えずに失敗する
test_今と同じ版なら失敗する
test_1つでも版の行が見つからなければどれも書き換えない
test_ファイルが無ければ失敗する
test_書き換えた後はcheck_release_tagの版の検査を通る

if [ "${failures}" -ne 0 ]; then
  printf '%d 件失敗\n' "${failures}" >&2
  exit 1
fi
printf 'すべて成功\n'
