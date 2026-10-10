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

    let has_tags = conn.prepare("PRAGMA table_info(cards)").expect("table info")
        .query_map([], |row| row.get::<_, String>(1)).expect("columns")
        .any(|name| matches!(name.as_deref(), Ok("tags")));
    if !has_tags {
        conn.execute("ALTER TABLE cards ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'", [])
            .expect("failed to add card tags");
    }
    let columns = conn.prepare("PRAGMA table_info(cards)").expect("table info").query_map([], |r| r.get::<_,String>(1)).expect("columns").collect::<Result<Vec<_>,_>>().expect("columns");
    for (column, declaration) in [("deck_id", "TEXT"), ("note_id", "TEXT"), ("anki", "TEXT")] {
        if !columns.iter().any(|c| c == column) { conn.execute(&format!("ALTER TABLE cards ADD COLUMN {column} {declaration}"), []).expect("card metadata migration"); }
    }
    conn
}

// ── Card ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Card {
    pub id: String,
    pub deck_id: Option<String>,
    pub note_id: Option<String>,
    pub anki: Option<serde_json::Value>,
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub example: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub fn get_cards(db: State<DbState>) -> Result<Vec<Card>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, front, back, example, created_at, tags, deck_id, note_id, anki FROM cards ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let cards = stmt
        .query_map([], |row| {
            Ok(Card {
                id: row.get(0)?,
                deck_id: row.get(6)?, note_id: row.get(7)?, anki: row.get::<_,Option<String>>(8)?.map(|v| serde_json::from_str(&v)).transpose().map_err(|e|rusqlite::Error::FromSqlConversionFailure(8,rusqlite::types::Type::Text,Box::new(e)))?,
                front: row.get(1)?,
                back: row.get(2)?,
                example: row.get(3)?,
                created_at: row.get(4)?,
                tags: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default(),
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
        "INSERT INTO cards (id, front, back, example, tags, deck_id, note_id, anki) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET front=excluded.front, back=excluded.back, example=excluded.example, tags=excluded.tags, deck_id=excluded.deck_id, note_id=excluded.note_id, anki=excluded.anki",
        params![card.id, card.front, card.back, card.example, serde_json::to_string(&card.tags).map_err(|e| e.to_string())?, card.deck_id, card.note_id, card.anki.map(|v| v.to_string())],
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
    tags: Vec<String>,
) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE cards SET front=?1, back=?2, example=?3, tags=?5 WHERE id=?4",
            params![front, back, example, id, serde_json::to_string(&tags).map_err(|e| e.to_string())?],
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

#[derive(Deserialize)]
pub struct RegenerationContent {
    front: String,
    back: String,
    example: Option<String>,
}
#[derive(Deserialize)]
pub struct RegenerationExpected {
    id: String,
    front: String,
    back: String,
    example: Option<String>,
}
#[tauri::command]
pub fn replace_regenerated_card(db: State<DbState>, expected: RegenerationExpected, draft: RegenerationContent) -> Result<(), String> {
    if draft.front.trim().is_empty() || draft.back.trim().is_empty() { return Err("卡片正反面不能为空".into()); }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn.execute(
        "UPDATE cards SET front=?1, back=?2, example=?3 WHERE id=?4 AND front=?5 AND back=?6 AND COALESCE(example, '')=?7",
        params![draft.front, draft.back, draft.example.filter(|s| !s.is_empty()), expected.id, expected.front, expected.back, expected.example.unwrap_or_default()],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("卡片内容已更新，请关闭后重新生成".into()); }
    Ok(())
}

fn confirm_ai_on_connection(conn: &mut Connection, draft_id: &str, card: &Card, expected: Option<&Card>, day: &str) -> Result<(), String> {
    if card.front.trim().is_empty() || card.back.trim().is_empty() || card.anki.is_some() { return Err("卡片正反面不能为空".into()); }
    // Receipt, formal card, seed and statistic commit in one SQLite transaction.
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ai_receipts (id TEXT PRIMARY KEY)").map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let seen: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_receipts WHERE id=?1)", [draft_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if seen { return Ok(()); }
    let tags = serde_json::to_string(&card.tags).map_err(|e| e.to_string())?;
    if let Some(expected) = expected {
        let changed = tx.execute("UPDATE cards SET front=?1, back=?2, example=?3, tags=?4, deck_id=?5 WHERE id=?6 AND front=?7 AND back=?8 AND COALESCE(example,'')=?9 AND tags=?10 AND COALESCE(deck_id,'')=?11 AND anki IS NULL",
            params![card.front, card.back, card.example, tags, card.deck_id, expected.id, expected.front, expected.back, expected.example.as_deref().unwrap_or(""), serde_json::to_string(&expected.tags).map_err(|e|e.to_string())?, expected.deck_id.as_deref().unwrap_or("")]).map_err(|e|e.to_string())?;
        if changed == 0 { return Err("卡片内容已更新或删除，请重新生成".into()); }
    } else {
        tx.execute("INSERT INTO cards (id,front,back,example,tags,deck_id,note_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,unixepoch())",params![card.id,card.front,card.back,card.example,tags,card.deck_id,card.note_id]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO progress (card_id,due) VALUES (?1,?2)",params![card.id,day]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO daily_stats (date,added) VALUES (?1,1) ON CONFLICT(date) DO UPDATE SET added=added+1", [day]).map_err(|e|e.to_string())?;
    }
    tx.execute("INSERT INTO ai_receipts (id) VALUES (?1)", [draft_id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn confirm_ai_draft(db: State<DbState>, draft_id: String, card: Card, expected: Option<Card>, day: String) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e|e.to_string())?;
    confirm_ai_on_connection(&mut conn, &draft_id, &card, expected.as_ref(), &day)
}

#[cfg(test)]
mod ai_tests {
    use super::*;
    #[test]
    fn confirmation_is_atomic_and_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE cards(id TEXT PRIMARY KEY,front TEXT,back TEXT,example TEXT,tags TEXT,deck_id TEXT,note_id TEXT,anki TEXT,created_at INTEGER); CREATE TABLE progress(card_id TEXT PRIMARY KEY,due TEXT); CREATE TABLE daily_stats(date TEXT PRIMARY KEY,added INTEGER);").unwrap();
        let card = Card { id:"custom:ai:test".into(),front:"q".into(),back:"a".into(),example:None,tags:vec![],deck_id:None,note_id:Some("pair".into()),anki:None,created_at:0 };
        confirm_ai_on_connection(&mut conn,"draft",&card,None,"2026-10-08").unwrap();
        confirm_ai_on_connection(&mut conn,"draft",&card,None,"2026-10-08").unwrap();
        assert_eq!(conn.query_row("SELECT added FROM daily_stats",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        conn.execute("UPDATE cards SET back='changed'",[]).unwrap();
        assert!(confirm_ai_on_connection(&mut conn,"replacement",&card,Some(&card),"2026-10-08").is_err());
        assert_eq!(conn.query_row("SELECT count(*) FROM ai_receipts",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
}
