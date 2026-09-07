#!/usr/bin/env bash
#
# check-release-tag.sh のテスト。
# 一時ディレクトリに実際の git リポジトリを作って動かす。
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly TARGET="${SCRIPT_DIR}/check-release-tag.sh"

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

write_manifests() {
  # package.json と src-tauri/Cargo.toml を指定したバージョンで書き出す。
  # Cargo.toml には依存関係側の version も置く（そちらを読まないことの確認用）。
  local repository="$1"
  local package_version="$2"
  local cargo_version="$3"

  cat >"${repository}/package.json" <<JSON
{
  "name": "koduchi",
  "private": true,
  "version": "${package_version}",
  "dependencies": {
    "react": "19.2.8"
  }
}
JSON

  mkdir -p "${repository}/src-tauri"
  cat >"${repository}/src-tauri/Cargo.toml" <<TOML
[package]
name = "koduchi"
version = "${cargo_version}"
edition = "2021"

[dependencies]
tauri = { version = "9.9.9", features = [] }
TOML
}

setup_repository() {
  # main ブランチに 1 コミットあるリポジトリを作り、その置き場所を標準出力に返す。
  # バージョンは package.json / Cargo.toml とも第 1 引数（既定 0.2.0）にする。
  local version="${1:-0.2.0}"
  local root
  root="$(mktemp -d)"

  git -C "${root}" init --quiet --initial-branch=main repository
  local repository="${root}/repository"
  git -C "${repository}" config user.email test@example.com
  git -C "${repository}" config user.name test
  write_manifests "${repository}" "${version}" "${version}"
  git -C "${repository}" add -A
  git -C "${repository}" commit --quiet -m 'initial'

  printf '%s\n' "${root}"
}

test_バージョンが揃っていてmainにあるタグは妥当と判定される() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" tag v0.2.0

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='バージョンが揃っていて main にあるタグは妥当と判定される'
  if [ "${status}" -eq 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_packagejsonのバージョンがタグと違うと失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  write_manifests "${repository}" 0.1.0 0.2.0
  git -C "${repository}" commit --quiet -am 'package.json だけ古いまま'
  git -C "${repository}" tag v0.2.0

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='package.json のバージョンがタグと違うと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_cargotomlのバージョンがタグと違うと失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  write_manifests "${repository}" 0.2.0 0.1.0
  git -C "${repository}" commit --quiet -am 'Cargo.toml だけ古いまま'
  git -C "${repository}" tag v0.2.0

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='Cargo.toml のバージョンがタグと違うと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_依存関係側のversionは読まない() {
  # Arrange
  # Cargo.toml の [dependencies] には version = "9.9.9" が入っている。
  # そちらを読んでいれば 0.2.0 のタグは失敗するはずである。
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" tag v0.2.0

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='Cargo.toml の依存関係側の version は読まない'
  if [ "${status}" -eq 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_タグ名がvバージョンの形でないと失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" tag 0.2.0

  # Act
  status=0
  "${TARGET}" 0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='タグ名が v<バージョン> の形でないと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_mainに含まれないコミットのタグは失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" checkout --quiet -b feature
  printf 'work\n' >"${repository}/work.txt"
  git -C "${repository}" add -A
  git -C "${repository}" commit --quiet -m '作業中'
  git -C "${repository}" tag v0.2.0

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='main に含まれないコミットのタグは失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_存在しないタグを指定すると失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='存在しないタグを指定すると失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_mainブランチが無くてもoriginmainがあれば判定できる() {
  # Arrange
  # CI がタグをチェックアウトした直後は、ローカルの main が存在せず
  # remotes/origin/main だけがある状態になる。
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" tag v0.2.0
  git -C "${repository}" update-ref refs/remotes/origin/main refs/heads/main
  git -C "${repository}" checkout --quiet v0.2.0
  git -C "${repository}" branch --quiet -D main

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='main ブランチが無くても origin/main があれば判定できる'
  if [ "${status}" -eq 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_KODUCHI_MAIN_REFでmainの参照を上書きできる() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" branch --quiet release
  git -C "${repository}" tag v0.2.0
  git -C "${repository}" branch --quiet -m main trunk

  # Act
  status=0
  KODUCHI_MAIN_REF=refs/heads/trunk \
    "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='KODUCHI_MAIN_REF で main の参照を上書きできる'
  if [ "${status}" -eq 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_mainの参照が無いと失敗する() {
  # Arrange
  local root repository status
  root="$(setup_repository 0.2.0)"
  repository="${root}/repository"
  git -C "${repository}" tag v0.2.0
  git -C "${repository}" branch --quiet -m main trunk

  # Act
  status=0
  "${TARGET}" v0.2.0 "${repository}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='main の参照が無いと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

printf '%s\n' "check-release-tag.sh"
test_バージョンが揃っていてmainにあるタグは妥当と判定される
test_packagejsonのバージョンがタグと違うと失敗する
test_cargotomlのバージョンがタグと違うと失敗する
test_依存関係側のversionは読まない
test_タグ名がvバージョンの形でないと失敗する
test_mainに含まれないコミットのタグは失敗する
test_存在しないタグを指定すると失敗する
test_mainブランチが無くてもoriginmainがあれば判定できる
test_KODUCHI_MAIN_REFでmainの参照を上書きできる
test_mainの参照が無いと失敗する

if [ "${failures}" -ne 0 ]; then
  printf '%d 件失敗\n' "${failures}" >&2
  exit 1
fi
printf 'すべて成功\n'
