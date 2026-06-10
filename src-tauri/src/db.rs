use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

fn db_path() -> PathBuf {
    let home = dirs::home_dir().expect("cannot find home directory");
    home.join(".vword")
}

pub fn init_db() -> Connection {
    let dir = db_path();
    fs::create_dir_all(&dir).expect("failed to create ~/.vword");
    let db_file = dir.join("vword.db");
    let conn = Connection::open(&db_file).expect("failed to open database");

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("failed to set pragmas");

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cards (
            id TEXT PRIMARY KEY,
            front TEXT NOT NULL,
            back TEXT NOT NULL,
            example TEXT,
            created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS progress (
            card_id TEXT PRIMARY KEY,
            ease REAL NOT NULL DEFAULT 2.5,
            interval INTEGER NOT NULL DEFAULT 0,
            repetitions INTEGER NOT NULL DEFAULT 0,
            due TEXT NOT NULL,
            last_reviewed_at INTEGER,
            FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            reviewed INTEGER NOT NULL DEFAULT 0,
            added INTEGER NOT NULL DEFAULT 0
        );",
    )
    .expect("failed to create tables");

    conn
}

// ── Card ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Card {
    pub id: String,
    pub front: String,
    pub back: String,
    pub example: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub fn get_cards(db: State<DbState>) -> Result<Vec<Card>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, front, back, example, created_at FROM cards ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let cards = stmt
        .query_map([], |row| {
            Ok(Card {
                id: row.get(0)?,
                front: row.get(1)?,
                back: row.get(2)?,
                example: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cards)
}

#[tauri::command]
pub fn save_card(db: State<DbState>, card: Card) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Preserve created_at on update; only set it if the row is new.
    conn.execute(
        "INSERT INTO cards (id, front, back, example) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET front=excluded.front, back=excluded.back, example=excluded.example",
        params![card.id, card.front, card.back, card.example],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_card(
    db: State<DbState>,
    id: String,
    front: String,
    back: String,
    example: Option<String>,
) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE cards SET front=?1, back=?2, example=?3 WHERE id=?4",
            params![front, back, example, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

#[tauri::command]
pub fn delete_card(db: State<DbState>, id: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute("DELETE FROM cards WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

// ── Progress ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Progress {
    pub card_id: String,
    pub ease: f64,
    pub interval: i64,
    pub repetitions: i64,
    pub due: String,
    pub last_reviewed_at: Option<i64>,
}

#[tauri::command]
pub fn get_progress(db: State<DbState>) -> Result<HashMap<String, Progress>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT card_id, ease, interval, repetitions, due, last_reviewed_at FROM progress")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Progress {
                card_id: row.get(0)?,
                ease: row.get(1)?,
                interval: row.get(2)?,
                repetitions: row.get(3)?,
                due: row.get(4)?,
                last_reviewed_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for r in rows {
        let p = r.map_err(|e| e.to_string())?;
        map.insert(p.card_id.clone(), p);
    }
    Ok(map)
}

#[tauri::command]
pub fn save_progress(db: State<DbState>, progress: Progress) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO progress (card_id, ease, interval, repetitions, due, last_reviewed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            progress.card_id,
            progress.ease,
            progress.interval,
            progress.repetitions,
            progress.due,
            progress.last_reviewed_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_progress(db: State<DbState>, card_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM progress WHERE card_id=?1", params![card_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Settings (KV) ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_setting(db: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |row| row.get(0),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_setting(db: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_all_settings(db: State<DbState>) -> Result<HashMap<String, String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for r in rows {
        let (k, v) = r.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

// ── Daily Stats ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyStat {
    pub date: String,
    pub reviewed: i64,
    pub added: i64,
}

#[tauri::command]
pub fn increment_daily_stat(
    db: State<DbState>,
    date: String,
    field: String,
) -> Result<(), String> {
    if field != "reviewed" && field != "added" {
        return Err(format!("invalid field: {}", field));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO daily_stats (date, reviewed, added) VALUES (?1, 0, 0)
         ON CONFLICT(date) DO NOTHING",
        params![date],
    )
    .map_err(|e| e.to_string())?;
    let sql = format!("UPDATE daily_stats SET {0} = {0} + 1 WHERE date = ?1", field);
    conn.execute(&sql, params![date])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_daily_stats(
    db: State<DbState>,
    from_date: String,
    to_date: String,
) -> Result<Vec<DailyStat>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT date, reviewed, added FROM daily_stats
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from_date, to_date], |row| {
            Ok(DailyStat {
                date: row.get(0)?,
                reviewed: row.get(1)?,
                added: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
