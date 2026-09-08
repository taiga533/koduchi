//! Oracle のエラーを区分へ写す（ADR 0017・0019・0021・0026）。
//!
//! 「権限が無くて見えない」を「空だった」と混同させないための変換と、
//! 「サーバ側で接続が切れた」を「SQL が失敗した」と混同させないための変換を
//! ここに集める。前者を要る場所が 3 つある。
//!
//! | 引く先                  | 番号の並び              | ADR  |
//! | ----------------------- | ----------------------- | ---- |
//! | `V$SESSION`             | `PERMISSION_ERRORS`     | 0017 |
//! | `DBMS_METADATA.GET_DDL` | `DDL_PERMISSION_ERRORS` | 0019 |
//! | `ALL_SOURCE`            | `PERMISSION_ERRORS`     | 0021 |
//!
//! 最初は `oracle::sessions` の中にあったものを、2 つ目が要ったところで切り出した。
//! GET_DDL だけ番号の並びが違うため、判定する番号は引数に取る形にしてある。
//! 辞書ビューを引くだけの側（0017・0021）は `map_permission_error` を呼べばよく、
//! 番号の一覧を意識しなくてよい。
//!
//! 接続断（ADR 0026）はそのどれとも直交する。**どの往復でも起こりうる**ため、
//! 権限を見るかどうかに関わらず `classify` が最初に見る。切れた接続へ
//! `V$SESSION` を引けば `ORA-03113` が返るが、これを「権限が無い」と読ませて
//! はならない。
//!
//! データベースが返した原文はメッセージへそのまま残す。番号で写し替えるのは
//! 区分だけであり、文言を作り替えて事実を丸めることはしない。

use crate::db::error::{DbError, DbErrorKind};

/// 権限が足りないことを示す Oracle のエラー番号。
///
/// `ORA-00942` は「表またはビューが存在しません」だが、`V$SESSION` や
/// `ALL_SOURCE` のような辞書ビューに対しては実際には参照権限が無いことを
/// 意味する。
pub const PERMISSION_ERRORS: [&str; 2] = ["ORA-00942", "ORA-01031"];

/// `DBMS_METADATA.GET_DDL` が権限不足のときに返しうる番号（ADR 0019）。
///
/// `ORA-31603` は「オブジェクトが見つかりません」だが、GET_DDL では
/// **他人のオブジェクトを見る権限が無いとき**にもこれが返る。オブジェクト名は
/// スキーマツリー（ADR 0007）が `ALL_OBJECTS` から取ってきたものであり、
/// 存在しないことはまず無い。そのため権限として扱い、案内にはその旨を書く。
pub const DDL_PERMISSION_ERRORS: [&str; 3] = ["ORA-00942", "ORA-01031", "ORA-31603"];

/// サーバ側で接続が切れたことを示す番号（ADR 0026）。
///
/// どれも**繋ぎ直せば直る**断である。認証の失敗（`ORA-01017`）や
/// リスナー不在（`ORA-12541`）は繋ぎ直しても直らないため、ここには入れない。
/// それらは接続を張るときにしか起きず、`DbError::connect` が受け持つ。
///
/// `DPI-` で始まる 2 つは ODPI-C 自身が返すもので、Oracle が `ORA-03113` を
/// 返す前にクライアント側で断を検出した場合はこちらが届く。番号だけを見て
/// 写し替えるため、両方を並べておく必要がある。
///
/// | 番号        | 意味                                             |
/// | ----------- | ------------------------------------------------ |
/// | `ORA-00028` | セッションが強制終了された（他者の kill、ADR 0017） |
/// | `ORA-01012` | ログオンしていない                               |
/// | `ORA-01089` | インスタンスが即時停止中                         |
/// | `ORA-02396` | プロファイルの `IDLE_TIME` を超過した             |
/// | `ORA-02399` | プロファイルの `CONNECT_TIME` を超過した          |
/// | `ORA-03113` | 通信チャネルでファイルの終わりを検出した         |
/// | `ORA-03114` | Oracle に接続されていない                        |
/// | `ORA-03135` | 接続が失われた                                   |
/// | `ORA-12570` | TNS: パケット・リーダーの障害                    |
/// | `ORA-12571` | TNS: パケット・ライターの障害                    |
/// | `DPI-1010`  | 接続していない（ODPI-C）                         |
/// | `DPI-1080`  | 接続が閉じられた（ODPI-C）                       |
pub const CONNECTION_LOST_ERRORS: [&str; 12] = [
    "ORA-00028",
    "ORA-01012",
    "ORA-01089",
    "ORA-02396",
    "ORA-02399",
    "ORA-03113",
    "ORA-03114",
    "ORA-03135",
    "ORA-12570",
    "ORA-12571",
    "DPI-1010",
    "DPI-1080",
];

/// 接続が切れたことを示す文言か（ADR 0026）。
///
/// # 引数
///
/// * `text` - データベースが返した文言
pub fn is_connection_lost(text: &str) -> bool {
    contains_error_code(text, &CONNECTION_LOST_ERRORS)
}

/// Oracle が返した文言から区分を見分ける（ADR 0026）。
///
/// **接続断を先に見る。**切れた接続へ辞書ビューを引いたときの `ORA-03113` を
/// 「権限が無い」と読ませてはならないためである。順序がこの関数の要点であり、
/// 純粋な関数にしてあるのはその順序をデータベース抜きで試せるようにするため
/// である。
///
/// # 引数
///
/// * `text` - データベースが返した文言
/// * `permission_codes` - 権限不足と見なす番号。見ないときは空でよい
pub fn classify(text: &str, permission_codes: &[&str]) -> DbErrorKind {
    if is_connection_lost(text) {
        return DbErrorKind::ConnectionLost;
    }

    if contains_error_code(text, permission_codes) {
        return DbErrorKind::Permission;
    }

    DbErrorKind::Execute
}

/// エラーの文言に、並べた番号のどれかが含まれるか。
///
/// # 引数
///
/// * `text` - データベースが返した文言
/// * `codes` - 探す番号
pub fn contains_error_code(text: &str, codes: &[&str]) -> bool {
    codes.iter().any(|code| text.contains(code))
}

/// Oracle のエラーを、権限不足なら `Permission` へ写す。
///
/// # 引数
///
/// * `context` - 何をしようとしていたか
/// * `error` - Oracle が返したエラー
/// * `hint` - 権限不足のときに添える案内
/// * `codes` - 権限不足と見なす番号
pub fn map_oracle_error(
    context: &str,
    error: &oracle::Error,
    hint: &str,
    codes: &[&str],
) -> DbError {
    let text = error.to_string();

    match classify(&text, codes) {
        DbErrorKind::ConnectionLost => DbError::connection_lost(format!("{context}: {text}")),
        DbErrorKind::Permission => DbError::permission(format!("{context}{hint}（{text}）")),
        _ => DbError::execute(format!("{context}: {text}")),
    }
}

/// 権限を見ずに、接続断だけを見分けて写す（ADR 0026）。
///
/// SQL の実行やカーソルの読み進めのように、権限不足という枝を持たない経路が
/// 使う。**この関数を通さずに `DbError::execute` を直に作ると、その経路だけが
/// 接続断に気付けなくなる。**
///
/// # 引数
///
/// * `context` - 何をしようとしていたか。空文字列なら文言をそのまま使う
/// * `error` - Oracle が返したエラー
pub fn map_execute_error(context: &str, error: &oracle::Error) -> DbError {
    let text = error.to_string();
    let message = if context.is_empty() {
        text.clone()
    } else {
        format!("{context}: {text}")
    };

    if is_connection_lost(&text) {
        return DbError::connection_lost(message);
    }

    DbError::execute(message)
}

/// 辞書ビューを引いたときのエラーを、権限不足なら `Permission` へ写す。
///
/// `PERMISSION_ERRORS` を当てる `map_oracle_error` の薄い包みである。
/// `V$SESSION`（ADR 0017）と `ALL_SOURCE`（ADR 0021）はどちらもこの並びで
/// 足りるため、呼び出し側が番号の一覧を持ち回らずに済む。
///
/// # 引数
///
/// * `context` - 何をしようとしていたか
/// * `error` - Oracle が返したエラー
/// * `hint` - 権限不足のときに添える案内
pub fn map_permission_error(context: &str, error: &oracle::Error, hint: &str) -> DbError {
    map_oracle_error(context, error, hint, &PERMISSION_ERRORS)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Oracle のエラーを組み立てる。
    ///
    /// 実際に届くのはドライバが作ったエラーだが、判定が見るのは文言だけである。
    /// 番号を含む文言を載せたエラーで代用する。
    ///
    /// # 引数
    ///
    /// * `message` - エラーの文言
    fn oracleのエラー(message: &str) -> oracle::Error {
        oracle::Error::new(oracle::ErrorKind::OciError, String::from(message))
    }

    #[test]
    fn 権限不足の番号を見分けられる() {
        // Arrange
        let text = "ORA-00942: table or view does not exist";

        // Act
        let 権限不足 = contains_error_code(text, &PERMISSION_ERRORS);

        // Assert
        assert!(権限不足);
    }

    #[test]
    fn 実行時のエラーは権限不足とは見なさない() {
        // Arrange
        let text = "ORA-00904: \"FOO\": invalid identifier";

        // Act & Assert
        assert!(!contains_error_code(text, &PERMISSION_ERRORS));
        assert!(!contains_error_code(text, &DDL_PERMISSION_ERRORS));
    }

    #[test]
    fn ddlのオブジェクト未検出は権限不足として扱う() {
        // Arrange: 名前は ALL_OBJECTS から取っている。存在しないことはまず無い
        let text = "ORA-31603: object \"ORDERS\" of type TABLE not found in schema \"KODUCHI\"";

        // Act & Assert
        assert!(contains_error_code(text, &DDL_PERMISSION_ERRORS));
        assert!(!contains_error_code(text, &PERMISSION_ERRORS));
    }

    #[test]
    fn 表が見えないエラーは権限不足として扱われる() {
        // Arrange
        let error = oracleのエラー("ORA-00942: table or view does not exist");

        // Act
        let mapped =
            map_permission_error("ALL_SOURCE を参照できません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Permission);
        assert!(mapped.message.contains("権限がありません"));
        assert!(mapped.message.contains("ORA-00942"));
    }

    #[test]
    fn 権限不足のエラーも同じ区分になる() {
        // Arrange
        let error = oracleのエラー("ORA-01031: insufficient privileges");

        // Act
        let mapped = map_permission_error("読めません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Permission);
    }

    #[test]
    fn 権限と関わらないエラーは実行エラーのままである() {
        // Arrange: 「見えない」と「失敗した」を取り違えないこと
        let error = oracleのエラー("ORA-00933: SQL command not properly ended");

        // Act
        let mapped = map_permission_error("読めません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Execute);
        assert!(mapped.message.contains("ORA-00933"));
    }

    #[test]
    fn アイドル時間の超過は接続断として扱う() {
        // Arrange: 昼休みのあとに最初に出会うのがこれである（ADR 0026）
        let error =
            oracleのエラー("ORA-02396: 最大アイドル時間を超過しました。再接続してください");

        // Act
        let mapped = map_execute_error("", &error);

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::ConnectionLost);
        assert!(mapped.message.contains("ORA-02396"));
    }

    #[test]
    fn 通信路の切断も接続断として扱う() {
        // Arrange: VPN の切断やサーバの再起動で届く
        for 番号 in [
            "ORA-03113",
            "ORA-03114",
            "ORA-12571",
            "ORA-12570",
            "ORA-01012",
        ] {
            let error = oracleのエラー(&format!("{番号}: 通信に失敗しました"));

            // Act
            let mapped = map_execute_error("実行に失敗しました", &error);

            // Assert
            assert_eq!(mapped.kind, DbErrorKind::ConnectionLost, "{番号}");
        }
    }

    #[test]
    fn odpicが返す断もその区分になる() {
        // Arrange: Oracle が ORA-03113 を返す前にクライアント側が気付くことがある
        let error = oracleのエラー("DPI-1080: connection was closed by ORA-3113");

        // Act
        let mapped = map_execute_error("", &error);

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::ConnectionLost);
    }

    #[test]
    fn 実行の失敗は接続断とは見なさない() {
        // Arrange: 綴りの誤りで「再接続」を勧めてはいけない
        let error = oracleのエラー("ORA-00904: \"FOO\": invalid identifier");

        // Act
        let mapped = map_execute_error("実行に失敗しました", &error);

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Execute);
    }

    #[test]
    fn 認証の失敗は接続断とは見なさない() {
        // Arrange: 繋ぎ直しても直らないものを「繋ぎ直せる」と言わない（ADR 0026）
        // Act & Assert
        assert!(!is_connection_lost("ORA-01017: invalid username/password"));
        assert!(!is_connection_lost("ORA-12541: TNS:no listener"));
        assert!(!is_connection_lost("ORA-28000: the account is locked"));
    }

    #[test]
    fn 切れた接続で辞書ビューを引いた断は権限不足より先に見る() {
        // Arrange: 切れた接続へ V$SESSION を引くと ORA-03113 が返る。
        // これを「権限が無い」と読ませると、再接続の道が出ない（ADR 0026）
        let error = oracleのエラー("ORA-03113: end-of-file on communication channel");

        // Act
        let mapped =
            map_permission_error("V$SESSION を参照できません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::ConnectionLost);
    }

    #[test]
    fn 区分の見分けは接続断を最初に見る() {
        // Arrange & Act & Assert: 純粋な関数として順序だけを確かめる
        assert_eq!(
            classify("ORA-03113: end-of-file", &PERMISSION_ERRORS),
            DbErrorKind::ConnectionLost
        );
        assert_eq!(
            classify(
                "ORA-00942: table or view does not exist",
                &PERMISSION_ERRORS
            ),
            DbErrorKind::Permission
        );
        assert_eq!(
            classify("ORA-00942: table or view does not exist", &[]),
            DbErrorKind::Execute
        );
    }

    #[test]
    fn 当てる番号の並びで同じエラーの区分が変わる() {
        // Arrange: GET_DDL だけが ORA-31603 を権限として扱う（ADR 0019）
        let error =
            oracleのエラー("ORA-31603: object \"ORDERS\" of type TABLE not found in schema");

        // Act
        let ddlとして = map_oracle_error(
            "DDL を取得できません",
            &error,
            "。権限がありません",
            &DDL_PERMISSION_ERRORS,
        );
        let 辞書ビューとして =
            map_permission_error("DDL を取得できません", &error, "。権限がありません");

        // Assert
        assert_eq!(ddlとして.kind, DbErrorKind::Permission);
        assert_eq!(辞書ビューとして.kind, DbErrorKind::Execute);
    }
}
