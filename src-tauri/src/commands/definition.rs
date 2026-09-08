//! テーブル定義ビューと DDL のコマンド（ADR 0019）。
//!
//! どちらもプールの「結果セットを保持していない接続」で走るため、利用者が
//! 見ている結果セット（ADR 0003）は壊れない。
//!
//! 定義と DDL を別のコマンドに分けてあるのは、`DBMS_METADATA.GET_DDL` が
//! 重く権限にも敏感であるためである。DDL の権限が無いというだけで、列と制約と
//! 索引まで見られなくなってはいけない。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::definition::{ObjectDdl, ObjectDefinition};
use crate::db::error::DbResult;
use crate::db::schema::ObjectKind;
use tauri::State;

/// テーブル定義ビュー 1 枚ぶんの内容を取る。
///
/// 列は段階 2（ADR 0007）のキャッシュを使い回さず、その場で引き直す。
/// 読み込みがまだ終わっていないスキーマを開かれたときに、半端な列の一覧を
/// 出さないためである。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
#[tauri::command]
pub async fn object_definition(
    state: State<'_, AppState>,
    id: ConnectionId,
    owner: String,
    name: String,
    kind: ObjectKind,
) -> DbResult<ObjectDefinition> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.object_definition(&owner, &name, kind)).await
}

/// オブジェクト 1 つの DDL を取る（`DBMS_METADATA.GET_DDL`）。
///
/// 権限が無い接続では `permission` の区分でエラーが返る。空の定義では
/// ない。「見えない」と「定義が空」は別物である。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
#[tauri::command]
pub async fn object_ddl(
    state: State<'_, AppState>,
    id: ConnectionId,
    owner: String,
    name: String,
    kind: ObjectKind,
) -> DbResult<ObjectDdl> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.object_ddl(&owner, &name, kind)).await
}
