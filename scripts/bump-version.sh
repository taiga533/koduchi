#!/usr/bin/env bash
#
# 小槌の版を 1 回で書き換える（ADR 0011）。
#
# 版の実体は package.json と src-tauri/Cargo.toml の 2 か所にあり、Cargo.lock も
# 小槌自身の版を控えている。手で 3 か所を揃えると 1 つ書き漏らし、タグを打ってから
# check-release-tag.sh に落とされる。書き換えはこのスクリプトに任せる。
#
# 書き換えるだけで、コミットもタグも打たない。タグは main へマージした後に打つ
# （ADR 0011 は、タグから版を書き換えてコミットする形を却下している）。
#
# 使い方:
#   scripts/bump-version.sh 0.3.0 [リポジトリ]
#
set -euo pipefail

usage() {
  echo "使い方: $(basename "$0") <版（例: 0.3.0）> [リポジトリ]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage

# `v0.3.0` と打っても通す。タグの綴りと取り違えやすいためである。
readonly VERSION="${1#v}"
readonly ROOT="${2:-$(git rev-parse --show-toplevel)}"

readonly PACKAGE_JSON="${ROOT}/package.json"
readonly CARGO_TOML="${ROOT}/src-tauri/Cargo.toml"
readonly CARGO_LOCK="${ROOT}/src-tauri/Cargo.lock"

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "版は <メジャー>.<マイナー>.<パッチ> の形で渡す: ${1}" >&2
  exit 1
fi

for file in "${PACKAGE_JSON}" "${CARGO_TOML}" "${CARGO_LOCK}"; do
  [ -f "${file}" ] || { echo "見つからない: ${file}" >&2; exit 1; }
done

# 書き換える前に今の版を読む。同じ版を渡されたら、打ち間違いとみなして止める。
current="$(jq -r .version "${PACKAGE_JSON}")"
if [ "${current}" = "${VERSION}" ]; then
  echo "既に ${VERSION} である" >&2
  exit 1
fi

# どのファイルも、書き換える行はちょうど 1 行でなければならない。0 行なら形が
# 変わっており、黙って進むと 1 か所だけ古い版が残る。
#
# 3 つとも書き換えられると分かるまでは元のファイルに触らない。途中で止まったときに
# 1 つだけ新しい版になった状態を残さないためである。
TARGETS=()
STAGED=()
cleanup() {
  # 一時ファイルを消す。書き換えを取りやめたときも、終えたときも同じである。
  local staged
  for staged in "${STAGED[@]+"${STAGED[@]}"}"; do
    rm -f "${staged}"
  done
}
trap cleanup EXIT

stage() {
  # 1 つのファイルの版の行を一時ファイルへ書き換え、書き換えた行数を確かめる。
  local file="$1"
  local program="$2"
  local tmp
  tmp="$(mktemp)"
  TARGETS+=("${file}")
  STAGED+=("${tmp}")
  awk -v version="${VERSION}" "${program}" "${file}" >"${tmp}"
  local changed
  changed="$(diff "${file}" "${tmp}" | grep -c '^>' || true)"
  if [ "${changed}" -ne 1 ]; then
    echo "${file} の版の行を 1 行に絞れなかった（${changed} 行）" >&2
    exit 1
  fi
}

# package.json はトップレベルの "version" だけを書き換える（字下げ 2 つの行）。
stage "${PACKAGE_JSON}" '
  !done && /^  "version": "[^"]*",?$/ { sub(/"version": "[^"]*"/, "\"version\": \"" version "\""); done = 1 }
  { print }
'

# Cargo.toml は [package] の中の version だけを書き換える。依存関係の version は触らない。
stage "${CARGO_TOML}" '
  /^\[/ { in_package = ($0 == "[package]") }
  in_package && !done && /^version = "/ { $0 = "version = \"" version "\""; done = 1 }
  { print }
'

# Cargo.lock は小槌自身の項（name = "koduchi" の直後の version）だけを書き換える。
stage "${CARGO_LOCK}" '
  prev == "name = \"koduchi\"" && /^version = "/ { $0 = "version = \"" version "\"" }
  { prev = $0; print }
'

# 3 つとも確かめ終えたので置き換える。mv は元のファイルの権限を引き継がないため、
# cat で中身だけを書き戻す。
for index in "${!TARGETS[@]}"; do
  cat "${STAGED[${index}]}" >"${TARGETS[${index}]}"
done

echo "${current} → ${VERSION} に書き換えた（package.json / src-tauri/Cargo.toml / src-tauri/Cargo.lock）"
echo "main へマージしてから: ./scripts/check-release-tag.sh v${VERSION} && git tag v${VERSION} && git push origin v${VERSION}"
