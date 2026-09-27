#!/usr/bin/env bash
#
# 自動アップデートの確認先に置く latest.json を組み立てて標準出力へ書く（ADR 0042）。
#
#   ./scripts/generate-latest-json.sh <タグ> <アセット名> <署名ファイル> [リポジトリ]
#
# latest.json はリリースごとに添付し、アプリは
# https://github.com/<リポジトリ>/releases/latest/download/latest.json を見にいく。
# この URL は公開済みの最新のリリースを指すため、イミュータブルリリースのまま
# 「常に最新を指す」置き場所になる。下書きは指さない。
#
# 公開日は KODUCHI_PUB_DATE で上書きできる（テストのため）。
#
set -euo pipefail

usage() {
  echo "usage: $0 <タグ> <アセット名> <署名ファイル> [リポジトリ]" >&2
  exit 2
}

[ "$#" -ge 3 ] && [ "$#" -le 4 ] || usage

readonly TAG="$1"
readonly ASSET="$2"
readonly SIGNATURE_FILE="$3"
readonly REPOSITORY="${4:-taiga533/koduchi}"

# 版はタグから v を落として取る。タグと package.json の一致は check-release-tag.sh が見ている。
if ! [[ "${TAG}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "タグが v<メジャー>.<マイナー>.<パッチ> の形ではない: ${TAG}" >&2
  exit 1
fi
readonly VERSION="${BASH_REMATCH[1]}"

# 署名が空のまま配ると、アプリは検証に失敗して更新できない。配る前にここで止める。
if [ ! -s "${SIGNATURE_FILE}" ]; then
  echo "署名ファイルが無いか空である: ${SIGNATURE_FILE}" >&2
  exit 1
fi

readonly PUB_DATE="${KODUCHI_PUB_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# 対象は Apple Silicon の macOS だけである（ADR 0011）。
jq -n \
  --arg version "${VERSION}" \
  --arg pub_date "${PUB_DATE}" \
  --arg signature "$(cat "${SIGNATURE_FILE}")" \
  --arg url "https://github.com/${REPOSITORY}/releases/download/${TAG}/${ASSET}" \
  '{
    version: $version,
    pub_date: $pub_date,
    platforms: {
      "darwin-aarch64": { signature: $signature, url: $url }
    }
  }'
