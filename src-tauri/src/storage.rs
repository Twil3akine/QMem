use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// Tauriが検索結果をJavaScriptへ渡せるよう、Serialize可能な形でメモを表す。
#[derive(Debug, Serialize)]
pub struct Note {
    pub id: i64,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// UI設定は1行だけ保持し、メモ本文のモデルとは分離する。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Settings {
    pub global_shortcut: String,
    pub new_note_shortcut: String,
    pub search_shortcut: String,
    pub font_size: i64,
    pub menu_bar_mode: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            global_shortcut: "Option+Space".into(),
            new_note_shortcut: "CommandOrControl+N".into(),
            search_shortcut: "CommandOrControl+K".into(),
            font_size: 18,
            menu_bar_mode: false,
        }
    }
}

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    // 一時的なロックは待機し、WALと完全同期で異常終了時のデータ消失を抑える。
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            global_shortcut TEXT NOT NULL,
            new_note_shortcut TEXT NOT NULL,
            search_shortcut TEXT NOT NULL,
            font_size INTEGER NOT NULL,
            menu_bar_mode INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO settings VALUES
            (1, 'Option+Space', 'CommandOrControl+N', 'CommandOrControl+K', 18, 0);",
    )
}

pub fn load_settings(db: &Connection) -> rusqlite::Result<Settings> {
    db.query_row(
        "SELECT global_shortcut, new_note_shortcut, search_shortcut, font_size, menu_bar_mode
         FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(Settings {
                global_shortcut: row.get(0)?,
                new_note_shortcut: row.get(1)?,
                search_shortcut: row.get(2)?,
                font_size: row.get(3)?,
                menu_bar_mode: row.get(4)?,
            })
        },
    )
}

pub fn save_settings(db: &Connection, settings: &Settings) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE settings SET global_shortcut = ?1, new_note_shortcut = ?2,
         search_shortcut = ?3, font_size = ?4, menu_bar_mode = ?5 WHERE id = 1",
        params![
            settings.global_shortcut,
            settings.new_note_shortcut,
            settings.search_shortcut,
            settings.font_size,
            settings.menu_bar_mode
        ],
    )?;
    Ok(())
}

pub fn save(db: &Connection, id: Option<i64>, body: &str) -> rusqlite::Result<Option<i64>> {
    // 空白だけの新規メモは保存せず、既存メモならレコード自体を削除する。
    // BOMも画面には見えないため、空白と同じものとして扱う。
    if body
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .is_empty()
    {
        if let Some(id) = id {
            db.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        }
        return Ok(None);
    }
    // JavaScriptのDateへそのまま渡せるよう、日時はUnix epochからのミリ秒で記録する。
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    if let Some(id) = id {
        // IDがあるメモは作成日時を維持し、本文と更新日時だけを書き換える。
        let changed = db.execute(
            "UPDATE notes SET body = ?1, updated_at = ?2 WHERE id = ?3",
            params![body, now, id],
        )?;
        if changed == 0 {
            // 存在しないIDを暗黙に新規作成せず、呼び出し元へ不整合を通知する。
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(Some(id))
    } else {
        // 新規メモを作成し、以後の更新で使うSQLiteの採番IDを返す。
        db.execute(
            "INSERT INTO notes (body, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![body, now],
        )?;
        Ok(Some(db.last_insert_rowid()))
    }
}

pub fn search(db: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    // instrを使うことで、%、_、引用符なども検索構文ではなく文字として扱う。
    // 空の検索語では全件を返し、作成日時とIDの新しい順に並べる。
    let mut statement = db.prepare(
        "SELECT id, body, created_at, updated_at FROM notes
        WHERE instr(lower(body), lower(?1)) > 0 OR ?1 = '' ORDER BY created_at DESC, id DESC",
    )?;
    let rows = statement.query_map([query], |row| {
        Ok(Note {
            id: row.get(0)?,
            body: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_insert_update_and_literal_full_body_search() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        for blank in ["", " \n\t", "\u{3000}\u{feff}"] {
            assert_eq!(save(&db, None, blank).unwrap(), None);
        }
        assert!(search(&db, "").unwrap().is_empty());
        let id = save(&db, None, "先頭\n本文末尾 ETA 100%_ ' SELECT").unwrap();
        let original = search(&db, "本文末尾").unwrap().remove(0);
        assert_eq!(search(&db, "%_").unwrap().len(), 1);
        assert_eq!(search(&db, "eta").unwrap().len(), 1);
        assert!(search(&db, "見つからない").unwrap().is_empty());
        assert_eq!(save(&db, id, "編集済み").unwrap(), id);
        let edited = search(&db, "編集").unwrap().remove(0);
        assert_eq!(edited.created_at, original.created_at);
        assert!(edited.updated_at >= original.updated_at);
        assert_eq!(search(&db, "").unwrap().len(), 1);
        assert_eq!(save(&db, id, " ").unwrap(), None);
        assert!(search(&db, "").unwrap().is_empty());
    }

    #[test]
    fn persists_after_reopening_database() {
        let path = std::env::temp_dir().join(format!(
            "qmem-test-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            save(&db, None, "終了直前の本文").unwrap();
        }
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            assert_eq!(search(&db, "").unwrap()[0].body, "終了直前の本文");
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn settings_have_defaults_and_persist() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        assert_eq!(load_settings(&db).unwrap(), Settings::default());

        let changed = Settings {
            global_shortcut: "CommandOrControl+Shift+Space".into(),
            new_note_shortcut: "CommandOrControl+Shift+N".into(),
            search_shortcut: "CommandOrControl+Shift+K".into(),
            font_size: 21,
            menu_bar_mode: true,
        };
        save_settings(&db, &changed).unwrap();
        assert_eq!(load_settings(&db).unwrap(), changed);
    }
}
