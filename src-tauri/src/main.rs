#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// SQLite接続をTauriの共有状態として保持し、同時アクセスはMutexで直列化する。
struct Database(Mutex<Connection>);

// フロントエンドの準備完了前や、正式な終了処理中に終了イベントを横取りしないための状態。
#[derive(Default)]
struct Lifecycle {
    ready: AtomicBool,
    exiting: AtomicBool,
}

// JavaScriptから呼ばれるコマンド。保存結果として、新規採番されたIDまたは削除後のNoneを返す。
#[tauri::command]
fn save_note(
    db: tauri::State<Database>,
    id: Option<i64>,
    body: String,
) -> Result<Option<i64>, String> {
    let db = db.0.lock().map_err(|e| e.to_string())?;
    storage::save(&db, id, &body).map_err(|e| e.to_string())
}

// JavaScriptから検索語を受け取り、本文が一致したメモを返す。
#[tauri::command]
fn search_notes(db: tauri::State<Database>, query: String) -> Result<Vec<storage::Note>, String> {
    let db = db.0.lock().map_err(|e| e.to_string())?;
    storage::search(&db, &query).map_err(|e| e.to_string())
}

// JavaScript側のイベント購読完了後に呼ばれ、ショートカット登録と初回表示を行う。
#[tauri::command]
fn ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    app.state::<Lifecycle>().ready.store(true, Ordering::SeqCst);
    let shortcut_error = app.global_shortcut()
        .on_shortcut("Option+Space", |app, _, event| {
            // キーを離したイベントでは二重に開かないよう、押下時だけ処理する。
            if event.state() == ShortcutState::Pressed {
                open_new_note(app);
            }
        })
        .err()
        .map(|error| format!("Option+Spaceを登録できませんでした。ほかのアプリとの競合を確認してください。{error}"));
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(shortcut_error)
}

// 保存完了後の終了だけは、下のExitRequestedハンドラで止めずに通す。
#[tauri::command]
fn finish_exit(app: tauri::AppHandle) {
    app.state::<Lifecycle>()
        .exiting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

// Cmd/Ctrl+Wではプロセスを終了せず、ウィンドウだけを隠して常駐させる。
#[tauri::command]
fn finish_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

// 非表示または最小化されたエディタを前面へ戻す。
#[tauri::command]
fn show_editor(window: tauri::WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

// 新規メモへの切り替えはJavaScript側へ通知し、現在の本文の保存を先に行わせる。
fn open_new_note(app: &tauri::AppHandle) {
    let _ = app.emit("qmem-open", ());
}

// macOSでDockアイコンがクリックされたとき、表示中なら前面へ、非表示なら新規メモへ進む。
fn reopen(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = show_editor(window);
        } else {
            open_new_note(app);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Lifecycle::default())
        .setup(|app| {
            // OS標準のアプリデータ領域にSQLiteファイルを作り、アプリ全体で共有する。
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let db = Connection::open(directory.join("notes.sqlite3"))?;
            storage::initialize(&db)?;
            app.manage(Database(Mutex::new(db)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_note,
            search_notes,
            ready,
            finish_exit,
            finish_hide,
            show_editor
        ])
        .on_window_event(|window, event| {
            // 閉じる要求をいったん止め、JavaScript側の保存後にウィンドウを隠す。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Lifecycle>();
                if state.ready.load(Ordering::SeqCst) && !state.exiting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("qmem-hide", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("QMem could not start")
        .run(|app, event| {
            // macOS固有のDock再クリックを、既存ウィンドウの再利用として処理する。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                reopen(app);
            }
            // OSからの終了要求をいったん止め、JavaScript側が保存を終えるまで待つ。
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<Lifecycle>();
                if state.ready.load(Ordering::SeqCst) && !state.exiting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("qmem-close", ());
                }
            }
        });
}
