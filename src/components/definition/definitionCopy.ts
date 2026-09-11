/**
 * テーブル定義タブの内容をクリップボードへ載せる文字列の組み立て（ADR 0019・0022）。
 *
 * 定義タブは見るだけの画面であり、そこから外へ持ち出す道が無かった。マウスで
 * 範囲選択する道はあるが、DDL は `whitespace-pre-wrap` で折り返されるため長い行の
 * 選択がずれ、パッケージのように仕様と本体が縦に並ぶとなおさら当てにならない。
 *
 * 決めたことは 3 つある。
 *
 * 1. **写すのは画面に出ているものである。**絞り込んでいるときは絞り込んだ後の
 *    行だけを渡す。見えていないものが混ざって貼られるのは、見えているものが
 *    欠けて貼られるのと同じくらい困る。**どちらを渡したかは呼び出し側が
 *    `filtered` を見て利用者へ伝える。**
 * 2. **表は必ず見出し付きで写す。**結果テーブルのコピー（`buildCopyText`）は
 *    矩形選択が相手なので見出しの有無を選ばせるが、ここで写すのは常に内訳
 *    まるごとである。表計算やチケットへ貼るときに見出しの無い 4 列は読めない。
 *    区切りはタブ、行区切りは `\n` で結果テーブルに揃える。
 * 3. **画面の欄をそのまま写す。**画面が札（`無効` / `自動生成` / `UNUSABLE`）で
 *    添えているものは、その札が乗っているセルへ括弧付きで入れる。矢印のような
 *    飾りだけは落とす。列のコメントの欄は画面と同じく、コメントの付いた列が
 *    1 つでもあるときだけ出す（ADR 0033）。
 *
 * **オブジェクトそのもののコメントは写さない（ADR 0033）。**それはパネルの
 * 見出しに出ているものであって、内訳の中身ではない。見出しの 1 行を混ぜると、
 * 表計算へ貼ったときに桁がずれる。
 *
 * DDL は `DBMS_METADATA.GET_DDL` の出力をそのまま渡す。**見出しも註釈も足さない。**
 * 貼り先は別の環境の SQL であり、小槌が付けた日本語の見出しが紛れ込んでよい場所
 * ではない（画面へそのまま出す ADR 0019 の決定と同じ考えである）。仕様と本体の
 * ように 2 つに割れているときは空行 1 つで繋ぐ。`SQLTERMINATOR` を真にしてある
 * ため、繋いだだけでそのまま流せる。
 *
 * 描画から切り離した純粋な関数だけを置く。
 */

import type {
  DdlPart,
  ObjectDdl,
  ObjectDefinition,
  TableColumn,
  TableConstraint,
  TableIndex,
} from '../../types/db'
import { CONSTRAINT_KIND_LABELS } from '../../types/db'
import type { DefinitionTab } from '../../stores/definition'
import {
  filterColumns,
  filterConstraints,
  filterIndexes,
  formatIndexColumns,
  formatReference,
  hasColumnComments,
  normalizeNeedle,
} from './definitionSearch'

/** 空の欄。画面の表と同じ字を使う。 */
const 空欄 = '—'

/** 組み立てたコピーの中身。 */
export interface DefinitionCopy {
  /** クリップボードへ書く文字列。 */
  text: string
  /**
   * 写した行数。DDL は行で数えるものではないため `null`。
   */
  count: number | null
  /** 絞り込みが効いている最中に写したか。 */
  filtered: boolean
}

/**
 * 1 行ぶんのセルをタブで繋ぐ。
 *
 * @param cells 左から順のセル
 */
function 行にする(cells: string[]): string {
  return cells.join('\t')
}

/**
 * 札を括弧付きで添える。札が無ければ本体だけを返す。
 *
 * @param 本体 セルの本文
 * @param 札 添える札。無いときは `null`
 */
function 札を添える(本体: string, 札: string | null): string {
  return 札 === null ? 本体 : `${本体} (${札})`
}

/**
 * 列の一覧を見出し付きのタブ区切りにする。
 *
 * `#` は絞り込む前の並び順を出す。画面と同じ番号を写すためであり、絞り込んだ
 * 一覧を貼ったときに「元の表の何番目の列か」が残る。
 *
 * **コメントの欄は、画面に出ているときだけ写す（ADR 0033）。**判定は画面と
 * 同じ `hasColumnComments` を絞り込む前の全列に当てて行う。写すのは画面に
 * 出ているものだという決まりに、欄の数も従う。
 *
 * @param shown 写す列（絞り込み済み）
 * @param all 絞り込む前の全列。`#` を数えるのと、コメントの欄を出すかの判定に使う
 */
export function buildColumnsCopyText(shown: TableColumn[], all: TableColumn[]): string {
  const コメントを出す = hasColumnComments(all)
  const 見出し = ['#', '列', '型', 'NULL']
  if (コメントを出す) {
    見出し.push('コメント')
  }
  const lines = [行にする(見出し)]

  for (const column of shown) {
    const cells = [
      String(all.indexOf(column) + 1),
      column.name,
      column.typeName,
      column.nullable ? '可' : 'NOT NULL',
    ]
    if (コメントを出す) {
      cells.push(column.comment ?? 空欄)
    }
    lines.push(行にする(cells))
  }

  return lines.join('\n')
}

/**
 * 制約の右端の欄を文字列にする。
 *
 * 画面の `ConstraintDetail` と同じことを言う。外部キーは参照先と削除規則、
 * 検査制約は条件、それ以外は空欄である。矢印は画面の飾りなので落とす。
 *
 * @param constraint 対象の制約
 */
export function formatConstraintDetail(constraint: TableConstraint): string {
  if (constraint.kind === 'foreignKey') {
    const 参照先 = formatReference(constraint)
    if (参照先 === null) {
      return '参照先を参照できません'
    }
    if (constraint.deleteRule && constraint.deleteRule !== 'NO ACTION') {
      return `${参照先} ON DELETE ${constraint.deleteRule}`
    }
    return 参照先
  }

  if (constraint.kind === 'check') {
    return constraint.searchCondition ?? 空欄
  }

  return 空欄
}

/**
 * 制約の一覧を見出し付きのタブ区切りにする。
 *
 * @param constraints 写す制約（絞り込み済み）
 */
export function buildConstraintsCopyText(constraints: TableConstraint[]): string {
  const lines = [行にする(['種別', '名前', '列', '参照先 / 条件'])]

  for (const constraint of constraints) {
    lines.push(
      行にする([
        札を添える(CONSTRAINT_KIND_LABELS[constraint.kind], constraint.enabled ? null : '無効'),
        constraint.name,
        constraint.columns.join(', ') || 空欄,
        formatConstraintDetail(constraint),
      ]),
    )
  }

  return lines.join('\n')
}

/**
 * 索引の一覧を見出し付きのタブ区切りにする。
 *
 * @param indexes 写す索引（絞り込み済み）
 */
export function buildIndexesCopyText(indexes: TableIndex[]): string {
  const lines = [行にする(['名前', '列', '一意', '種類'])]

  for (const index of indexes) {
    lines.push(
      行にする([
        札を添える(index.name, index.generated ? '自動生成' : null),
        formatIndexColumns(index) || 空欄,
        index.unique ? 'UNIQUE' : 空欄,
        札を添える(index.indexType, index.status && index.status !== 'VALID' ? index.status : null),
      ]),
    )
  }

  return lines.join('\n')
}

/**
 * DDL の断片を繋ぐ。
 *
 * 見出しも註釈も足さず、空行 1 つで繋ぐだけである。前後の空白は落とす
 * （`GET_DDL` は先頭に改行を付けて返すことがあり、繋ぎ目の空行が増えるため）。
 *
 * @param parts 繋ぐ断片
 */
export function buildDdlCopyText(parts: DdlPart[]): string {
  return parts
    .map((part) => part.sql.trim())
    .filter((sql) => sql !== '')
    .join('\n\n')
}

/**
 * 今の内訳から、クリップボードへ載せる中身を組み立てる。
 *
 * 写せるものが無いときは `null` を返す。呼び出し側はそれを見てボタンを
 * 押せなくする。
 *
 * @param tab 開いている内訳
 * @param definition 取得した定義。未取得なら `null`
 * @param ddl 取得した DDL。未取得なら `null`
 * @param search 絞り込み語
 */
export function buildDefinitionCopy(
  tab: DefinitionTab,
  definition: ObjectDefinition | null,
  ddl: ObjectDdl | null,
  search: string,
): DefinitionCopy | null {
  if (tab === 'ddl') {
    const text = ddl === null ? '' : buildDdlCopyText(ddl.parts)
    return text === '' ? null : { text, count: null, filtered: false }
  }

  if (definition === null) {
    return null
  }

  const filtered = normalizeNeedle(search) !== ''

  if (tab === 'columns') {
    const shown = filterColumns(definition.columns, search)
    return shown.length === 0
      ? null
      : { text: buildColumnsCopyText(shown, definition.columns), count: shown.length, filtered }
  }

  if (tab === 'constraints') {
    const shown = filterConstraints(definition.constraints, search)
    return shown.length === 0
      ? null
      : { text: buildConstraintsCopyText(shown), count: shown.length, filtered }
  }

  const shown = filterIndexes(definition.indexes, search)
  return shown.length === 0
    ? null
    : { text: buildIndexesCopyText(shown), count: shown.length, filtered }
}

/**
 * 押した後に出す一言を作る。
 *
 * **絞り込んでいたかどうかを必ず言う。**コピーは何も起きないように見える操作
 * であり、絞り込んだままだと気づかないまま欠けたものを貼ることになる。件数を
 * 添えるのは、貼り先で数を確かめられるようにするためである。
 *
 * @param copy 組み立てたコピーの中身
 */
export function describeDefinitionCopy(copy: DefinitionCopy): string {
  if (copy.count === null) {
    return 'DDL をコピーしました'
  }

  const 件数 = `${copy.count.toLocaleString('ja-JP')} 件`
  return copy.filtered ? `絞り込んだ ${件数}をコピーしました` : `${件数}をコピーしました`
}
