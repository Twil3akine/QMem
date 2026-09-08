#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

struct Database(Mutex<Connection>);
#[derive(Default)]
struct Lifecycle {
    ready: AtomicBool,
    exiting: AtomicBool,
}

#[tauri::command]
fn save_note(
    db: tauri::State<Database>,
    id: Option<i64>,
    body: String,
) -> Result<Option<i64>, String> {
    let db = db.0.lock().map_err(|e| e.to_string())?;
    storage::save(&db, id, &body).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_notes(db: tauri::State<Database>, query: String) -> Result<Vec<storage::Note>, String> {
    let db = db.0.lock().map_err(|e| e.to_string())?;
    storage::search(&db, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    app.state::<Lifecycle>().ready.store(true, Ordering::SeqCst);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn finish_exit(app: tauri::AppHandle) {
    app.state::<Lifecycle>()
        .exiting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn finish_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_editor(window: tauri::WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn reopen(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = show_editor(window);
        } else {
            let _ = window.emit("qmem-open", ());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Lifecycle::default())
        .setup(|app| {
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
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                reopen(app);
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<Lifecycle>();
                if state.ready.load(Ordering::SeqCst) && !state.exiting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("qmem-close", ());
                }
            }
        });
}
