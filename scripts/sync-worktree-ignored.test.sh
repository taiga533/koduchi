#!/usr/bin/env bash
#
# sync-worktree-ignored.sh のテスト。
# 一時ディレクトリに実際の git リポジトリとワークツリーを作って動かす。
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly TARGET="${SCRIPT_DIR}/sync-worktree-ignored.sh"

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

setup_repository() {
  # コミット済みのメインワークツリーと、無視されるファイル群と、
  # 空のワークツリーを 1 つ用意し、その置き場所を標準出力に返す。
  local root
  root="$(mktemp -d)"

  git -C "${root}" init --quiet main
  local main="${root}/main"
  git -C "${main}" config user.email test@example.com
  git -C "${main}" config user.name test
  printf 'node_modules\nbuild\ndist\nsecret.local\n.DS_Store\n*.log\n' >"${main}/.gitignore"
  printf 'hello\n' >"${main}/README.md"
  mkdir -p "${main}/src"
  printf 'export {}\n' >"${main}/src/index.ts"
  git -C "${main}" add -A
  git -C "${main}" commit --quiet -m 'initial'

  mkdir -p "${main}/node_modules/pkg" "${main}/build" "${main}/dist"
  printf 'dep\n' >"${main}/node_modules/pkg/index.js"
  printf 'artifact\n' >"${main}/build/app.js"
  printf 'bundle\n' >"${main}/dist/app.js"
  printf 'token\n' >"${main}/secret.local"
  printf '' >"${main}/.DS_Store"
  printf 'log\n' >"${main}/src/app.log"

  git -C "${main}" worktree add --quiet -b feature "${root}/feature" >/dev/null
  printf '%s\n' "${root}"
}

test_無視されたファイルがコピー先に複製される() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  "${TARGET}" --from "${main}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='無視されたファイルがコピー先に複製される'
  if [ -f "${feature}/node_modules/pkg/index.js" ] &&
    [ -f "${feature}/build/app.js" ] &&
    [ -f "${feature}/secret.local" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_追跡されているファイルはコピーされない() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"
  rm -f "${feature}/README.md"

  # Act
  "${TARGET}" --from "${main}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='追跡されているファイルはコピーされない'
  if [ ! -e "${feature}/README.md" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_コピー先に既にあるエントリは上書きしない() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"
  printf 'keep\n' >"${feature}/secret.local"

  # Act
  "${TARGET}" --from "${main}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='コピー先に既にあるエントリは上書きしない'
  if [ "$(cat "${feature}/secret.local")" = 'keep' ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_forceを付けるとコピー先のエントリを上書きする() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"
  printf 'keep\n' >"${feature}/secret.local"

  # Act
  "${TARGET}" --from "${main}" --force "${feature}" >/dev/null 2>&1

  # Assert
  local name='--force を付けるとコピー先のエントリを上書きする'
  if [ "$(cat "${feature}/secret.local")" = 'token' ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_excludeで指定したエントリはコピーされない() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  "${TARGET}" --from "${main}" --exclude node_modules "${feature}" >/dev/null 2>&1

  # Assert
  local name='--exclude で指定したエントリはコピーされない'
  if [ ! -e "${feature}/node_modules" ] && [ -f "${feature}/build/app.js" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_dryrunでは何もコピーせず一覧だけを出す() {
  # Arrange
  local root main feature output
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  output="$("${TARGET}" --from "${main}" --dry-run "${feature}" 2>/dev/null)"

  # Assert
  local name='--dry-run では何もコピーせず一覧だけを出す'
  if [ ! -e "${feature}/node_modules" ] &&
    [ ! -e "${feature}/secret.local" ] &&
    printf '%s\n' "${output}" | grep -q '^node_modules$'; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_コピー元と同じワークツリーを指すと失敗する() {
  # Arrange
  local root main status
  root="$(setup_repository)"
  main="${root}/main"

  # Act
  status=0
  "${TARGET}" --from "${main}" "${main}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='コピー元と同じワークツリーを指すと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_別のリポジトリを指すと失敗する() {
  # Arrange
  local root other status
  root="$(setup_repository)"
  other="$(mktemp -d)"
  git -C "${other}" init --quiet

  # Act
  status=0
  "${TARGET}" --from "${root}/main" "${other}" >/dev/null 2>&1 || status=$?

  # Assert
  local name='別のリポジトリを指すと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}" "${other}"
}

test_既定の除外一覧にあるエントリはコピーされない() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  "${TARGET}" --from "${main}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='既定の除外一覧にあるエントリはコピーされない'
  if [ ! -e "${feature}/dist" ] && [ ! -e "${feature}/.DS_Store" ] &&
    [ ! -e "${feature}/src/app.log" ] &&
    [ -f "${feature}/node_modules/pkg/index.js" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_no_default_excludesを付けると既定の除外もコピーされる() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  "${TARGET}" --from "${main}" --no-default-excludes "${feature}" >/dev/null 2>&1

  # Assert
  local name='--no-default-excludes を付けると既定の除外もコピーされる'
  if [ -f "${feature}/dist/app.js" ] && [ -e "${feature}/.DS_Store" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_コピー元を省略するとカレントのワークツリー以外から自動で選ばれる() {
  # Arrange
  local root feature
  root="$(setup_repository)"
  feature="${root}/feature"

  # Act
  (cd "${feature}" && "${TARGET}" >/dev/null 2>&1)

  # Assert
  local name='コピー元を省略するとカレントのワークツリー以外から自動で選ばれる'
  if [ -f "${feature}/node_modules/pkg/index.js" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_コピー元は引き継ぐ対象を持つワークツリーが選ばれる() {
  # Arrange
  local root main feature filled
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"
  filled="${root}/filled"
  git -C "${main}" worktree add --quiet -b filled "${filled}" >/dev/null
  mkdir -p "${filled}/node_modules/pkg"
  printf 'from-filled\n' >"${filled}/node_modules/pkg/index.js"
  # メインワークツリーからは引き継ぐ対象を消しておく。
  rm -rf "${main}/node_modules" "${main}/build" "${main}/secret.local"

  # Act
  "${TARGET}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='コピー元は引き継ぐ対象を持つワークツリーが選ばれる'
  if [ "$(cat "${feature}/node_modules/pkg/index.js" 2>/dev/null)" = 'from-filled' ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_除外パターンは階層を問わずベース名で照合する() {
  # Arrange
  local root main feature
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"

  # Act
  "${TARGET}" --from "${main}" --no-default-excludes --exclude 'app.log' \
    "${feature}" >/dev/null 2>&1

  # Assert
  local name='除外パターンは階層を問わずベース名で照合する'
  if [ ! -e "${feature}/src/app.log" ] && [ -f "${feature}/dist/app.js" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_コピーしてもファイルの更新時刻が保たれる() {
  # Arrange
  local root main feature source_mtime dest_mtime
  root="$(setup_repository)"
  main="${root}/main"
  feature="${root}/feature"
  touch -t 202001020304.05 "${main}/secret.local"

  # Act
  "${TARGET}" --from "${main}" "${feature}" >/dev/null 2>&1

  # Assert
  local name='コピーしてもファイルの更新時刻が保たれる'
  source_mtime="$(stat -f %m "${main}/secret.local")"
  dest_mtime="$(stat -f %m "${feature}/secret.local")"
  if [ "${source_mtime}" = "${dest_mtime}" ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

printf '%s\n' "sync-worktree-ignored.sh"
test_無視されたファイルがコピー先に複製される
test_追跡されているファイルはコピーされない
test_コピー先に既にあるエントリは上書きしない
test_forceを付けるとコピー先のエントリを上書きする
test_excludeで指定したエントリはコピーされない
test_dryrunでは何もコピーせず一覧だけを出す
test_コピー元と同じワークツリーを指すと失敗する
test_別のリポジトリを指すと失敗する
test_既定の除外一覧にあるエントリはコピーされない
test_no_default_excludesを付けると既定の除外もコピーされる
test_コピー元を省略するとカレントのワークツリー以外から自動で選ばれる
test_コピー元は引き継ぐ対象を持つワークツリーが選ばれる
test_除外パターンは階層を問わずベース名で照合する
test_コピーしてもファイルの更新時刻が保たれる

if [ "${failures}" -ne 0 ]; then
  printf '%d 件失敗\n' "${failures}" >&2
  exit 1
fi
printf 'すべて成功\n'
