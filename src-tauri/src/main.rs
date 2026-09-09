#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// SQLite接続をTauriの共有状態として保持し、同時アクセスはMutexで直列化する。
struct Database(Mutex<Connection>);

// フロントエンドの準備完了前や、正式な終了処理中に終了イベントを横取りしないための状態。
#[derive(Default)]
struct Lifecycle {
    ready: AtomicBool,
    exiting: AtomicBool,
    global_shortcut: Mutex<Option<String>>,
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

#[tauri::command]
fn load_settings(db: tauri::State<Database>) -> Result<storage::Settings, String> {
    let db = db.0.lock().map_err(|e| e.to_string())?;
    storage::load_settings(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| e.to_string())
}

fn validate_settings(settings: &storage::Settings) -> Result<(), String> {
    if !(15..=24).contains(&settings.font_size) {
        return Err("文字サイズは15pxから24pxの間で指定してください。".into());
    }
    let shortcuts = [
        &settings.global_shortcut,
        &settings.new_note_shortcut,
        &settings.search_shortcut,
    ];
    if shortcuts[0] == shortcuts[1] || shortcuts[0] == shortcuts[2] || shortcuts[1] == shortcuts[2]
    {
        return Err("同じショートカットを複数の操作には設定できません。".into());
    }
    for shortcut in shortcuts {
        shortcut
            .parse::<Shortcut>()
            .map_err(|_| "このキーの組み合わせは使用できません。".to_string())?;
    }
    Ok(())
}

fn register_global_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                open_new_note(app);
            }
        })
        .map_err(|error| format!("ショートカットを登録できませんでした。ほかのアプリとの競合を確認してください。{error}"))
}

fn apply_menu_bar_mode(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("qmem")
        .ok_or_else(|| "メニューバーアイコンを初期化できませんでした。".to_string())?;
    tray.set_visible(enabled).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    app.set_activation_policy(if enabled {
        tauri::ActivationPolicy::Accessory
    } else {
        tauri::ActivationPolicy::Regular
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    db: tauri::State<Database>,
    settings: storage::Settings,
) -> Result<(), String> {
    validate_settings(&settings)?;
    let old = {
        let db = db.0.lock().map_err(|e| e.to_string())?;
        storage::load_settings(&db).map_err(|e| e.to_string())?
    };

    if old.global_shortcut != settings.global_shortcut {
        register_global_shortcut(&app, &settings.global_shortcut)?;
        if let Err(error) = app
            .global_shortcut()
            .unregister(old.global_shortcut.as_str())
        {
            let _ = app
                .global_shortcut()
                .unregister(settings.global_shortcut.as_str());
            return Err(error.to_string());
        }
    }

    if old.menu_bar_mode != settings.menu_bar_mode {
        if let Err(error) = apply_menu_bar_mode(&app, settings.menu_bar_mode) {
            if old.global_shortcut != settings.global_shortcut {
                let _ = app
                    .global_shortcut()
                    .unregister(settings.global_shortcut.as_str());
                let _ = register_global_shortcut(&app, &old.global_shortcut);
            }
            return Err(error);
        }
    }

    let result = {
        let db = db.0.lock().map_err(|e| e.to_string())?;
        storage::save_settings(&db, &settings).map_err(|e| e.to_string())
    };
    if let Err(error) = result {
        if old.global_shortcut != settings.global_shortcut {
            let _ = app
                .global_shortcut()
                .unregister(settings.global_shortcut.as_str());
            let _ = register_global_shortcut(&app, &old.global_shortcut);
        }
        if old.menu_bar_mode != settings.menu_bar_mode {
            let _ = apply_menu_bar_mode(&app, old.menu_bar_mode);
        }
        return Err(error);
    }
    *app.state::<Lifecycle>()
        .global_shortcut
        .lock()
        .map_err(|e| e.to_string())? = Some(settings.global_shortcut);
    Ok(())
}

// JavaScript側のイベント購読完了後に呼ばれ、ショートカット登録と初回表示を行う。
#[tauri::command]
fn ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    app.state::<Lifecycle>().ready.store(true, Ordering::SeqCst);
    let shortcut = {
        let db = app.state::<Database>();
        let db = db.0.lock().map_err(|e| e.to_string())?;
        storage::load_settings(&db)
            .map_err(|e| e.to_string())?
            .global_shortcut
    };
    let shortcut_error = register_global_shortcut(&app, &shortcut).err();
    if shortcut_error.is_none() {
        *app.state::<Lifecycle>()
            .global_shortcut
            .lock()
            .map_err(|e| e.to_string())? = Some(shortcut);
    }
    // ログイン項目からの起動では、ショートカットだけ準備して画面を奪わない。
    if !std::env::args().any(|argument| argument == "--autostart") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Lifecycle::default())
        .setup(|app| {
            // OS標準のアプリデータ領域にSQLiteファイルを作り、アプリ全体で共有する。
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let db = Connection::open(directory.join("notes.sqlite3"))?;
            storage::initialize(&db)?;
            let settings = storage::load_settings(&db)?;
            app.manage(Database(Mutex::new(db)));

            let new_note = MenuItem::with_id(app, "new-note", "新しいメモ", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "QMemを終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&new_note, &quit])?;
            let mut tray = TrayIconBuilder::with_id("qmem")
                .menu(&menu)
                .tooltip("QMem")
                .icon_as_template(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "new-note" => open_new_note(app),
                    "quit" => {
                        if app.state::<Lifecycle>().ready.load(Ordering::SeqCst) {
                            let _ = app.emit("qmem-close", ());
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let tray = tray.build(app)?;
            tray.set_visible(settings.menu_bar_mode)?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(if settings.menu_bar_mode {
                tauri::ActivationPolicy::Accessory
            } else {
                tauri::ActivationPolicy::Regular
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_note,
            search_notes,
            load_settings,
            autostart_enabled,
            app_version,
            set_autostart,
            save_app_settings,
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
