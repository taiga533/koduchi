#!/usr/bin/env bash
#
# リリースタグが妥当かどうかを検査する。
#
# GitHub のイミュータブルリリースは公開したら差し替えられないため、
# ビルドを始める前にここで止める。見るのは次の 3 点。
#
#   1. タグ名が v<バージョン> の形をしている
#   2. package.json と src-tauri/Cargo.toml のバージョンがタグと一致する
#      （tauri.conf.json は package.json を参照するので対象にしない）
#   3. タグの指すコミットが main に含まれている
#
# 使い方:
#   scripts/check-release-tag.sh v0.2.0 [リポジトリ]
#
set -euo pipefail

readonly PROGRAM_NAME="$(basename "$0")"

# main の参照は環境によって名前が違う。ローカルでは main、
# CI のチェックアウト直後は origin/main しか無いことがある。
readonly MAIN_REF_CANDIDATES=(
  'refs/heads/main'
  'refs/remotes/origin/main'
)

usage() {
  # 使い方を標準出力に書き出す。
  cat <<USAGE
使い方: ${PROGRAM_NAME} <タグ名> [リポジトリ]

リリースタグが妥当かどうかを検査する。妥当なら 0、そうでなければ
理由を標準エラーに書いて 0 以外で終了する。

リポジトリを省略した場合はカレントディレクトリを含むワークツリーを対象にする。

環境変数:
  KODUCHI_MAIN_REF  main の参照名を上書きする（既定: ${MAIN_REF_CANDIDATES[*]} の順で探す）

オプション:
  -h, --help  この使い方を表示する
USAGE
}

abort() {
  # エラーメッセージを出して終了する。
  printf '%s: %s\n' "${PROGRAM_NAME}" "$*" >&2
  exit 1
}

parse_tag_version() {
  # タグ名から先頭の v を取り除いたバージョンを返す。
  # v0.2.0 や v1.0.0-rc.1 のような形でなければ失敗する。
  local tag="$1"
  [[ "${tag}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]] ||
    abort "タグ名が v<バージョン> の形ではない: ${tag}"
  printf '%s\n' "${BASH_REMATCH[1]}"
}

read_package_json_version() {
  # package.json の最上位の version を返す。
  local file="$1"
  [ -f "${file}" ] || abort "ファイルが存在しない: ${file}"
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "${file}" | head -n 1
}

read_cargo_toml_version() {
  # Cargo.toml の [package] セクションの version を返す。
  # 依存関係側の version を拾わないよう、セクションを見て絞る。
  local file="$1"
  [ -f "${file}" ] || abort "ファイルが存在しない: ${file}"
  awk '
    /^\[/ { in_package = ($0 ~ /^\[package\]/); next }
    in_package && /^[[:space:]]*version[[:space:]]*=/ {
      # version = "0.2.0" の右辺から引用符の中身だけを取り出す。
      if (match($0, /"[^"]*"/) || match($0, /'"'"'[^'"'"']*'"'"'/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
      }
      exit
    }
  ' "${file}"
}

resolve_main_ref() {
  # main を指す参照を 1 つ選んで返す。見つからなければ失敗する。
  local root="$1"
  if [ -n "${KODUCHI_MAIN_REF:-}" ]; then
    git -C "${root}" rev-parse --verify --quiet "${KODUCHI_MAIN_REF}^{commit}" >/dev/null ||
      abort "KODUCHI_MAIN_REF が指す参照が無い: ${KODUCHI_MAIN_REF}"
    printf '%s\n' "${KODUCHI_MAIN_REF}"
    return 0
  fi

  local candidate
  for candidate in "${MAIN_REF_CANDIDATES[@]}"; do
    if git -C "${root}" rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  abort "main の参照が見つからない（${MAIN_REF_CANDIDATES[*]} を探した）"
}

check_versions_match() {
  # package.json と Cargo.toml のバージョンがタグと一致することを確かめる。
  local root="$1"
  local expected="$2"

  local package_version cargo_version
  package_version="$(read_package_json_version "${root}/package.json")"
  cargo_version="$(read_cargo_toml_version "${root}/src-tauri/Cargo.toml")"

  [ "${package_version}" = "${expected}" ] ||
    abort "package.json のバージョンがタグと違う: ${package_version}（タグは ${expected}）"
  [ "${cargo_version}" = "${expected}" ] ||
    abort "src-tauri/Cargo.toml のバージョンがタグと違う: ${cargo_version}（タグは ${expected}）"
}

check_tag_on_main() {
  # タグの指すコミットが main に含まれていることを確かめる。
  local root="$1"
  local tag="$2"

  git -C "${root}" rev-parse --verify --quiet "refs/tags/${tag}^{commit}" >/dev/null ||
    abort "タグが存在しない: ${tag}"

  local main_ref
  main_ref="$(resolve_main_ref "${root}")"

  git -C "${root}" merge-base --is-ancestor "refs/tags/${tag}^{commit}" "${main_ref}" ||
    abort "タグ ${tag} の指すコミットが ${main_ref} に含まれていない"
}

main() {
  local tag=""
  local repository_arg=""

  while [ $# -gt 0 ]; do
    case "$1" in
      -h | --help)
        usage
        return 0
        ;;
      -*)
        abort "知らないオプション: $1"
        ;;
      *)
        if [ -z "${tag}" ]; then
          tag="$1"
        elif [ -z "${repository_arg}" ]; then
          repository_arg="$1"
        else
          abort "引数が多い: $1"
        fi
        shift
        ;;
    esac
  done

  [ -n "${tag}" ] || {
    usage >&2
    abort "タグ名が要る"
  }

  local root
  root="$(git -C "${repository_arg:-$PWD}" rev-parse --show-toplevel 2>/dev/null)" ||
    abort "git のワークツリーではない: ${repository_arg:-$PWD}"

  local version
  version="$(parse_tag_version "${tag}")"
  check_versions_match "${root}" "${version}"
  check_tag_on_main "${root}" "${tag}"

  printf 'タグ %s は妥当（バージョン %s）\n' "${tag}" "${version}"
}

main "$@"
