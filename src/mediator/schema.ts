/**
 * スキーマツリーの裁定（ADR 0007・0018・0035）。
 *
 * パレットからツリーのオブジェクトを示すと、サイドバーの面の切り替えと
 * ツリーの絞り込み・開閉が同時に要る。画面とスキーマの 2 つのストアに
 * またがるため、仲介者に置く。
 */

import { useConnectionStore } from '../stores/connection'
import { nodeKey, useSchemaStore } from '../stores/schema'
import { useUiStore } from '../stores/ui'

/**
 * パレットで選んだスキーマのオブジェクトをサイドバーで示す。
 *
 * ツリーへ位置を伝える仕組みは足さず、既にある絞り込みと開閉で済ませる。
 * スキーマを開いたうえで名前を検索欄へ入れれば、その 1 件だけが残る。
 *
 * @param schemaName スキーマの名前
 * @param objectName オブジェクトの名前。スキーマそのものを選んだなら `null`
 */
export function revealSchemaObject(schemaName: string, objectName: string | null): void {
  useUiStore.getState().selectSidebarSegment('schema')
  const schema = useSchemaStore.getState()
  schema.setSearch(objectName ?? schemaName)
  if (!schema.expanded[nodeKey(schemaName)]) {
    schema.toggle(nodeKey(schemaName))
  }
}

/**
 * 今の接続のスキーマツリーを取り直す。
 *
 * サイドバーの再読み込みボタンと同じ動き。DDL を流した直後に、サイドバーへ
 * 手を伸ばさずに取り直すための入口（パレット）が呼ぶ。
 */
export function reloadSchemas(): void {
  const active = useConnectionStore.getState().connection
  if (active) {
    void useSchemaStore.getState().reload(active.id)
  }
}
