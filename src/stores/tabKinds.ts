/**
 * 2 種類のタブが混ざった並びの扱い（ADR 0022）。
 *
 * エディタのタブ帯には SQL タブと定義タブが**同じ 1 本の配列**で並ぶ。並び順・
 * 選択・閉じるといった操作はどちらも同じに扱えるが、中身の持ち物は違う。
 * SQL タブは内容と保存先と未保存の印を持ち、定義タブは「どのオブジェクトの
 * 定義か」だけを持つ。
 *
 * ここは**その振り分けだけ**を担う純粋な関数の置き場である。ストアの手続きから
 * 切り離してあるのは、並びが混ざったときの扱い（足す・選ぶ・セッションへ出す・
 * セッションから戻す）をテストで固めるためである。
 */

import type { DefinitionTarget, SessionTab } from '../types/db'
import type { DefinitionEditorTab, EditorTab, SqlTab } from './tab'

/**
 * SQL を書くタブか。
 *
 * 内容・保存先・未保存の印を触る前に必ず通す。
 *
 * @param tab 判定するタブ
 */
export function isSqlTab(tab: EditorTab): tab is SqlTab {
  return tab.kind === 'sql'
}

/**
 * オブジェクトの定義を見るタブか（ADR 0022）。
 *
 * @param tab 判定するタブ
 */
export function isDefinitionTab(tab: EditorTab): tab is DefinitionEditorTab {
  return tab.kind === 'definition'
}

/**
 * タブに `●` の印を出すか。
 *
 * 定義タブは編集できないため、未保存になりようがない。
 *
 * @param tab 判定するタブ
 */
export function isDirty(tab: EditorTab): boolean {
  return isSqlTab(tab) && tab.dirty
}

/**
 * 定義タブに出す名前（ADR 0022）。
 *
 * オブジェクト名だけを出し、所有者は添えない。タブ帯は 1 枚が細く、
 * `KODUCHI.SHIPMENTS` では名前の後ろが削れる。所有者と種別は定義タブの
 * 見出しに出る。SQL タブとの見分けはタブ帯のアイコンが担う。
 *
 * @param target 対象のオブジェクト
 */
export function definitionTabName(target: DefinitionTarget): string {
  return target.name
}

/**
 * 同じオブジェクトを指す対象か。
 *
 * 所有者・名前・種別の 3 つがすべて一致したときだけ同じと見なす。同名で種別の
 * 違うオブジェクト（表とその索引など）は別の対象である。
 *
 * @param a 比べる対象
 * @param b 比べる対象
 */
export function sameDefinitionTarget(a: DefinitionTarget, b: DefinitionTarget): boolean {
  return a.owner === b.owner && a.name === b.name && a.kind === b.kind
}

/**
 * 同じ対象を開いている定義タブを探す（ADR 0022）。
 *
 * 見つからなければ `null`。
 *
 * @param tabs タブの並び
 * @param target 探す対象
 */
export function findDefinitionTab(
  tabs: EditorTab[],
  target: DefinitionTarget,
): DefinitionEditorTab | null {
  return (
    tabs.find(
      (tab): tab is DefinitionEditorTab =>
        isDefinitionTab(tab) && sameDefinitionTarget(tab.target, target),
    ) ?? null
  )
}

/** 定義タブを足した結果。 */
export interface OpenedDefinitionTab {
  /** 足したあと（または見つけたあと）のタブの並び。 */
  tabs: EditorTab[]
  /** 選択するタブの ID。 */
  activeTabId: string
  /** 新しく足したか。既にあるタブへ移ったときは偽。 */
  created: boolean
}

/**
 * 定義タブを開く（ADR 0022）。
 *
 * **同じ対象のタブが既にあれば 2 枚目を開かず、そのタブへ移る。**定義は読むだけ
 * の画面であり、2 枚並べても片方は必ず同じものを映す。開いたぶんだけ
 * `ALL_TAB_COLUMNS` などへの問い合わせが増える点も、同じものを 2 度取る理由に
 * ならない。
 *
 * 新しいタブは**並びの末尾**へ足す。`⌘T` で開く SQL タブと同じ場所であり、
 * 「新しいタブは右端に増える」という 1 つの規則で済む。
 *
 * @param tabs 今のタブの並び
 * @param target 開く対象
 * @param id 新しいタブに与える識別子
 */
export function openDefinitionTab(
  tabs: EditorTab[],
  target: DefinitionTarget,
  id: string,
): OpenedDefinitionTab {
  const 既にある = findDefinitionTab(tabs, target)
  if (既にある) {
    return { tabs, activeTabId: 既にある.id, created: false }
  }

  const tab: DefinitionEditorTab = {
    kind: 'definition',
    id,
    name: definitionTabName(target),
    target,
  }
  return { tabs: [...tabs, tab], activeTabId: tab.id, created: true }
}

/**
 * セッションへ書き出すタブを選び出す（ADR 0005・0022）。
 *
 * **定義タブは書き出さない。**定義は接続に属し、切断すれば捨てられる
 * （ADR 0019）。小槌は接続そのものを復元しないため、書き出したところで
 * 再起動後は中身を出せない。しかも次に繋ぐ先が別の接続なら、そのオブジェクトは
 * 存在すらしない。SQL タブは書きかけの文章であり接続に依らないため、これまで
 * どおり丸ごと書き出す。
 *
 * @param tabs タブの並び
 */
export function toSessionTabs(tabs: EditorTab[]): SessionTab[] {
  return tabs.filter(isSqlTab).map((tab) => ({
    id: tab.id,
    name: tab.name,
    filePath: tab.filePath,
    content: tab.content,
    dirty: tab.dirty,
  }))
}

/**
 * セッションから SQL タブを組み直す（ADR 0005・0022）。
 *
 * 書き出す側が定義タブを落としているため、読む側で振り分ける必要は無い。
 * それでも SQL タブとして組み立てることを型で示しておく。
 *
 * @param tabs セッションに保存されていたタブ
 */
export function fromSessionTabs(tabs: SessionTab[]): SqlTab[] {
  return tabs.map((tab) => ({
    kind: 'sql',
    id: tab.id,
    name: tab.name,
    filePath: tab.filePath,
    content: tab.content,
    dirty: tab.dirty,
  }))
}
