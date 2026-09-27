//! 自動アップデートの再起動（ADR 0042）。
//!
//! 入れ替えそのものは `tauri-plugin-updater` が行う。ここが持つのは「入れ替えた後、
//! どうやって新しい版で起ち上げ直すか」だけである。
//!
//! 再起動はアプリの終了と同じ道を通す。各ウィンドウへ閉じる要求を送り、フロントエンドの
//! 未コミットの関所（ADR 0012）を通ったウィンドウから閉じていく。すべて閉じ終えたときに
//! 再起動の予約があれば、終了の代わりに起ち上げ直す。`AppHandle::restart` を直に呼ぶと
//! 関所を飛ばし、未コミットの変更が暗黙のロールバックで消えるためである。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// 再起動の予約。すべてのウィンドウが閉じたときに、終了の代わりに起ち上げ直すかを持つ。
///
/// ウィンドウをまたいで 1 つだけ持つ。どのウィンドウが閉じるのを最後に通ったかに
/// 関わらず、予約はアプリに対して 1 つだからである。
#[derive(Default)]
pub struct RestartReservation(AtomicBool);

impl RestartReservation {
    /// 再起動を予約する。
    pub fn reserve(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// 予約を取り消す。どこかのウィンドウが閉じるのを断ったときに呼ぶ。
    ///
    /// 取り消さないと、後で利用者が普通に終了したときに思いがけず起ち上がり直す。
    pub fn cancel(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    /// 予約されているか。
    pub fn is_reserved(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// 終了の要求（`RunEvent::ExitRequested`）への応じ方。
#[derive(Debug, PartialEq, Eq)]
pub enum ExitDecision {
    /// そのまま終了させる。
    Proceed,
    /// 終了を止め、各ウィンドウへ閉じる要求を送る（関所を通すため）。
    CloseWindows,
    /// 終了を止め、起ち上げ直す。
    Restart,
}

/// 終了の要求にどう応じるかを決める。
///
/// 判断を `RunEvent` から切り離しておくのは、ウィンドウの数と予約の組み合わせを
/// Tauri の実行時なしに試すためである。
///
/// @param code 要求に付いた終了コード。付いていれば明示的な終了（再起動を含む）であり、割り込まない
/// @param open_windows 開いているウィンドウの数
/// @param restart_reserved 再起動が予約されているか
pub fn decide_exit(code: Option<i32>, open_windows: usize, restart_reserved: bool) -> ExitDecision {
    if code.is_some() {
        return ExitDecision::Proceed;
    }
    if open_windows > 0 {
        return ExitDecision::CloseWindows;
    }
    if restart_reserved {
        return ExitDecision::Restart;
    }
    ExitDecision::Proceed
}

/// 開いているすべてのウィンドウへ閉じる要求を送る。
///
/// `destroy` ではなく `close` を使う。`close` はフロントエンドの `onCloseRequested` を
/// 通り、未コミットの関所（ADR 0012）が閉じるかどうかを決めるためである。
pub fn close_all_windows<R: Runtime>(app: &AppHandle<R>) {
    for window in app.webview_windows().values() {
        // 閉じられなかったウィンドウは開いたまま残り、利用者の目に見える。
        // 終了の道と同じく、ここで止めない。
        let _ = window.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 終了コードの付いた要求には割り込まない() {
        // Arrange
        let code = Some(tauri::RESTART_EXIT_CODE);

        // Act
        let decision = decide_exit(code, 2, true);

        // Assert
        assert_eq!(decision, ExitDecision::Proceed);
    }

    #[test]
    fn ウィンドウが残っていれば閉じる要求を送る() {
        // Arrange
        let open_windows = 2;

        // Act
        let decision = decide_exit(None, open_windows, true);

        // Assert
        assert_eq!(decision, ExitDecision::CloseWindows);
    }

    #[test]
    fn すべて閉じ終えて再起動が予約されていれば起ち上げ直す() {
        // Arrange
        let reserved = true;

        // Act
        let decision = decide_exit(None, 0, reserved);

        // Assert
        assert_eq!(decision, ExitDecision::Restart);
    }

    #[test]
    fn すべて閉じ終えて予約が無ければ終了する() {
        // Arrange
        let reserved = false;

        // Act
        let decision = decide_exit(None, 0, reserved);

        // Assert
        assert_eq!(decision, ExitDecision::Proceed);
    }

    #[test]
    fn 予約を取り消すと予約されていない状態へ戻る() {
        // Arrange
        let reservation = RestartReservation::default();
        reservation.reserve();

        // Act
        reservation.cancel();

        // Assert
        assert!(!reservation.is_reserved());
    }
}
