#!/usr/bin/env bash
#
# git worktree を切った直後に、.gitignore で無視されているファイル群
# （node_modules / src-tauri/target など）を既存のワークツリーから
# 新しいワークツリーへ引き継ぐ。
#
# APFS では clone（copy-on-write）でコピーするため、巨大なディレクトリでも
# ほぼ一瞬で終わり、ディスクも実質消費しない。mtime は保つ（cargo と vite の
# 差分判定を壊さないため）。
#
# 使い方:
#   scripts/sync-worktree-ignored.sh [オプション] [コピー先]
#
set -euo pipefail

readonly PROGRAM_NAME="$(basename "$0")"

# 既定で引き継がないエントリ。引き継ぐと害があるか、引き継ぐ意味が薄いもの。
# --no-default-excludes を付けるとこの一覧を使わない。
readonly DEFAULT_EXCLUDES=(
  # vite のビルド成果物。数秒で作り直せるうえ、古い成果物が残っていると
  # `bun run preview` で別ブランチの画面を見てしまう。
  'dist'
  # Tauri が capabilities から生成する。生成物と capabilities の食い違いは
  # 実行時の権限エラーとして出るので原因が掴みにくい。作り直させる。
  'src-tauri/gen'
  # 前のワークツリーのログが混ざると読み違える。
  'logs'
  '*.log'
  # Finder の残骸。
  '.DS_Store'
)

usage() {
  # 使い方を標準出力に書き出す。
  cat <<USAGE
使い方: ${PROGRAM_NAME} [オプション] [コピー先ワークツリー]

.gitignore で無視されているファイル群を、既存のワークツリーから
コピー先のワークツリーへ複製する。

コピー先を省略した場合はカレントディレクトリを含むワークツリーを対象にする。
コピー元は --from を省略すると自動で選ぶ（無視されているエントリを最も多く
持つワークツリー。同数ならメインワークツリー）。

既定で引き継がないエントリ: ${DEFAULT_EXCLUDES[*]}

オプション:
  --from <パス>          コピー元のワークツリー（既定: 自動判別）
  --exclude <パターン>   コピーしないエントリ。/ を含まないパターンは階層を問わず
                         ベース名と、含むパターンはワークツリー相対のパスと glob で
                         照合する。複数回指定できる。
  --no-default-excludes  既定の除外一覧を使わない
  --force                コピー先に既に存在するエントリを削除してから上書きする
  --dry-run              実際にはコピーせず、何をするのかだけを表示する
  -h, --help             この使い方を表示する
USAGE
}

log() {
  # 進捗を標準エラーへ書き出す。標準出力はコピーしたパスの一覧に使う。
  printf '%s\n' "$*" >&2
}

abort() {
  # エラーメッセージを出して終了する。
  printf '%s: %s\n' "${PROGRAM_NAME}" "$*" >&2
  exit 1
}

worktree_root() {
  # 指定したディレクトリを含むワークツリーの絶対パスを返す。
  local dir="$1"
  [ -d "${dir}" ] || abort "ディレクトリが存在しない: ${dir}"
  git -C "${dir}" rev-parse --show-toplevel 2>/dev/null ||
    abort "git のワークツリーではない: ${dir}"
}

list_worktrees() {
  # リポジトリのワークツリーの絶対パスを、メインワークツリーを先頭にして列挙する。
  local dir="$1"
  git -C "${dir}" worktree list --porcelain |
    awk '/^worktree /{print substr($0, 10)}'
}

repository_id() {
  # 同じリポジトリのワークツリーかどうかを比べるための共通 git ディレクトリを返す。
  local dir="$1"
  local common_dir
  common_dir="$(git -C "${dir}" rev-parse --path-format=absolute --git-common-dir)"
  # シンボリックリンク越しでも一致するよう実体のパスに揃える。
  (cd "${common_dir}" && pwd -P)
}

list_ignored_entries() {
  # ワークツリー内で無視されているエントリをワークツリー相対の NUL 区切りで列挙する。
  # 丸ごと無視されているディレクトリは、その中身を展開せずディレクトリ単位で返す。
  local root="$1"
  git -C "${root}" ls-files -z --others --ignored --exclude-standard \
    --directory --no-empty-directory
}

count_copyable_entries() {
  # そのワークツリーが持つ「引き継ぐ対象になるエントリ」の数を返す。
  # コピー元を自動で選ぶときの物差しに使う。
  local root="$1"
  local count=0
  local entry
  while IFS= read -r -d '' entry; do
    is_excluded "${entry%/}" || count=$((count + 1))
  done < <(list_ignored_entries "${root}")
  printf '%s\n' "${count}"
}

select_source_worktree() {
  # コピー先以外のワークツリーから、引き継ぐ対象を最も多く持つものを選ぶ。
  # git worktree list はメインワークツリーを先頭に返すので、同数ならメインが勝つ。
  local dest_root="$1"
  local best=''
  local best_count=-1
  local candidate count
  while IFS= read -r candidate; do
    [ -d "${candidate}" ] || continue
    [ "${candidate}" != "${dest_root}" ] || continue
    count="$(count_copyable_entries "${candidate}")"
    if [ "${count}" -gt "${best_count}" ]; then
      best="${candidate}"
      best_count="${count}"
    fi
  done < <(list_worktrees "${dest_root}")

  [ -n "${best}" ] || abort "コピー元にできるワークツリーが見つからない（--from で指定する）"
  [ "${best_count}" -gt 0 ] || abort "どのワークツリーにも引き継ぐエントリがない"
  printf '%s\n' "${best}"
}

matches_pattern() {
  # エントリが除外パターンに合致するなら 0 を返す。
  # gitignore と同じく、/ を含まないパターンは階層を問わずベース名に照合する。
  local entry="$1"
  local pattern="${2%/}"
  case "${pattern}" in
    */*)
      # shellcheck disable=SC2053
      [[ "${entry}" == ${pattern} || "${entry}" == ${pattern}/* ]]
      ;;
    *)
      # shellcheck disable=SC2053
      [[ "${entry}" == ${pattern} || "${entry}" == */${pattern} ||
        "${entry}" == ${pattern}/* || "${entry}" == */${pattern}/* ]]
      ;;
  esac
}

is_excluded() {
  # エントリが除外対象なら 0 を返す。
  local entry="${1%/}"
  local pattern
  for pattern in ${EXCLUDES[@]+"${EXCLUDES[@]}"}; do
    if matches_pattern "${entry}" "${pattern}"; then
      return 0
    fi
  done
  return 1
}

copy_entry() {
  # エントリ 1 つをコピー元からコピー先へ複製する。
  # APFS の clone を試し、対応していないファイルシステムでは通常のコピーに落とす。
  # -p で mtime を保つ。これを落とすと cargo が target を丸ごと作り直す。
  local source_path="$1"
  local dest_path="$2"
  mkdir -p "$(dirname "${dest_path}")"
  cp -Rpc "${source_path}" "${dest_path}" 2>/dev/null ||
    cp -Rp "${source_path}" "${dest_path}"
}

main() {
  local source_root=""
  local dest_arg=""
  local force=0
  local dry_run=0
  local use_default_excludes=1
  local extra_excludes=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --from)
        [ $# -ge 2 ] || abort "--from にはパスが要る"
        source_root="$2"
        shift 2
        ;;
      --exclude)
        [ $# -ge 2 ] || abort "--exclude にはパターンが要る"
        extra_excludes+=("$2")
        shift 2
        ;;
      --no-default-excludes)
        use_default_excludes=0
        shift
        ;;
      --force)
        force=1
        shift
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      -h | --help)
        usage
        return 0
        ;;
      -*)
        abort "知らないオプション: $1"
        ;;
      *)
        [ -z "${dest_arg}" ] || abort "コピー先は 1 つだけ指定できる"
        dest_arg="$1"
        shift
        ;;
    esac
  done

  EXCLUDES=()
  if [ "${use_default_excludes}" -eq 1 ]; then
    EXCLUDES=("${DEFAULT_EXCLUDES[@]}")
  fi
  EXCLUDES+=(${extra_excludes[@]+"${extra_excludes[@]}"})

  local dest_root
  dest_root="$(worktree_root "${dest_arg:-$PWD}")"

  if [ -n "${source_root}" ]; then
    source_root="$(worktree_root "${source_root}")"
  else
    source_root="$(select_source_worktree "${dest_root}")"
  fi

  [ "${source_root}" != "${dest_root}" ] ||
    abort "コピー元とコピー先が同じワークツリーである: ${dest_root}"
  [ "$(repository_id "${source_root}")" = "$(repository_id "${dest_root}")" ] ||
    abort "コピー元とコピー先が別のリポジトリを指している"

  log "コピー元: ${source_root}"
  log "コピー先: ${dest_root}"

  local entries=()
  local entry
  while IFS= read -r -d '' entry; do
    entries+=("${entry}")
  done < <(list_ignored_entries "${source_root}")

  local copied=0
  local skipped=0
  local relative source_path dest_path
  for entry in ${entries[@]+"${entries[@]}"}; do
    relative="${entry%/}"
    if is_excluded "${relative}"; then
      log "除外: ${relative}"
      skipped=$((skipped + 1))
      continue
    fi

    source_path="${source_root}/${relative}"
    dest_path="${dest_root}/${relative}"

    if [ -e "${dest_path}" ]; then
      if [ "${force}" -eq 0 ]; then
        log "既に存在するので飛ばす: ${relative}（上書きするなら --force）"
        skipped=$((skipped + 1))
        continue
      fi
      [ "${dry_run}" -eq 1 ] || rm -rf "${dest_path}"
    fi

    [ "${dry_run}" -eq 1 ] || copy_entry "${source_path}" "${dest_path}"
    printf '%s\n' "${relative}"
    copied=$((copied + 1))
  done

  if [ "${dry_run}" -eq 1 ]; then
    log "コピー予定 ${copied} 件 / 飛ばした ${skipped} 件（--dry-run のため何もしていない）"
  else
    log "コピー ${copied} 件 / 飛ばした ${skipped} 件"
  fi
}

main "$@"
