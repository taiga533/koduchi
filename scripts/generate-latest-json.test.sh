#!/usr/bin/env bash
#
# generate-latest-json.sh のテスト。
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly TARGET="${SCRIPT_DIR}/generate-latest-json.sh"

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

test_タグとアセットと署名からlatestjsonを組み立てる() {
  # Arrange
  local root
  root="$(mktemp -d)"
  printf 'dW50cnVzdGVkIGNvbW1lbnQ=' >"${root}/app.tar.gz.sig"

  # Act
  local output
  output="$(KODUCHI_PUB_DATE=2026-09-27T00:00:00Z "${TARGET}" v0.3.0 \
    koduchi_0.3.0_aarch64.app.tar.gz "${root}/app.tar.gz.sig" example/koduchi)"

  # Assert
  local expected
  expected="$(jq -n '{
    version: "0.3.0",
    pub_date: "2026-09-27T00:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "dW50cnVzdGVkIGNvbW1lbnQ=",
        url: "https://github.com/example/koduchi/releases/download/v0.3.0/koduchi_0.3.0_aarch64.app.tar.gz"
      }
    }
  }')"
  local name='タグとアセットと署名から latest.json を組み立てる'
  if [ "$(jq -S . <<<"${output}")" = "$(jq -S . <<<"${expected}")" ]; then
    pass "${name}"
  else
    fail "${name}: ${output}"
  fi
  rm -rf "${root}"
}

test_リポジトリを省くと小槌のリポジトリを指す() {
  # Arrange
  local root
  root="$(mktemp -d)"
  printf 'sig' >"${root}/app.tar.gz.sig"

  # Act
  local url
  url="$("${TARGET}" v0.3.0 a.tar.gz "${root}/app.tar.gz.sig" \
    | jq -r '.platforms["darwin-aarch64"].url')"

  # Assert
  local name='リポジトリを省くと小槌のリポジトリを指す'
  if [ "${url}" = 'https://github.com/taiga533/koduchi/releases/download/v0.3.0/a.tar.gz' ]; then
    pass "${name}"
  else
    fail "${name}: ${url}"
  fi
  rm -rf "${root}"
}

test_タグが版の形でないと失敗する() {
  # Arrange
  local root
  root="$(mktemp -d)"
  printf 'sig' >"${root}/app.tar.gz.sig"

  # Act
  local status=0
  "${TARGET}" 0.3.0 a.tar.gz "${root}/app.tar.gz.sig" >/dev/null 2>&1 || status=$?

  # Assert
  local name='タグが v<版> の形でないと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_署名が空だと失敗する() {
  # Arrange
  local root
  root="$(mktemp -d)"
  : >"${root}/app.tar.gz.sig"

  # Act
  local status=0
  "${TARGET}" v0.3.0 a.tar.gz "${root}/app.tar.gz.sig" >/dev/null 2>&1 || status=$?

  # Assert
  local name='署名が空だと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

test_署名ファイルが無いと失敗する() {
  # Arrange
  local root
  root="$(mktemp -d)"

  # Act
  local status=0
  "${TARGET}" v0.3.0 a.tar.gz "${root}/missing.sig" >/dev/null 2>&1 || status=$?

  # Assert
  local name='署名ファイルが無いと失敗する'
  if [ "${status}" -ne 0 ]; then
    pass "${name}"
  else
    fail "${name}"
  fi
  rm -rf "${root}"
}

printf '%s\n' "generate-latest-json.sh"
test_タグとアセットと署名からlatestjsonを組み立てる
test_リポジトリを省くと小槌のリポジトリを指す
test_タグが版の形でないと失敗する
test_署名が空だと失敗する
test_署名ファイルが無いと失敗する

if [ "${failures}" -ne 0 ]; then
  printf '%d 件失敗\n' "${failures}" >&2
  exit 1
fi
printf 'すべて成功\n'
