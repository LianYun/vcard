import Foundation
import SQLite3

// Read-only migration: the original SQLite database remains a rollback backup.
// Stable event IDs make retry after a crash (and duplicate cloud imports) harmless.
enum LegacyImport {
    static func events(at path: String, source: String) throws -> [SyncEvent] {
        guard FileManager.default.fileExists(atPath: path) else { return [] }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            if let db { sqlite3_close(db) }
            throw failure("无法读取旧版数据库")
        }
        defer { sqlite3_close(db) }
        func rows(_ sql: String) throws -> [[String: String]] {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw failure("旧版数据库结构不兼容") }
            defer { sqlite3_finalize(stmt) }
            var result: [[String: String]] = []
            while true {
                let step = sqlite3_step(stmt)
                if step == SQLITE_DONE { return result }
                guard step == SQLITE_ROW else { throw failure("读取旧版数据库失败") }
                var row: [String: String] = [:]
                for i in 0..<sqlite3_column_count(stmt) {
                    if let text = sqlite3_column_text(stmt, i) {
                        row[String(cString: sqlite3_column_name(stmt, i))] = String(cString: text)
                    }
                }
                result.append(row)
            }
        }
        // One consistent snapshot even if an older desktop process is writing.
        guard sqlite3_exec(db, "BEGIN", nil, nil, nil) == SQLITE_OK else { throw failure("无法打开迁移事务") }
        defer { sqlite3_exec(db, "ROLLBACK", nil, nil, nil) }
        var events: [SyncEvent] = []
        func add(_ event: SyncEvent, _ key: String) {
            var event = event
            event.id = "legacy:\(source):\(key)"
            event.timestamp = 0 // Existing edits/configuration always take precedence.
            if event.kind != .add && event.kind != .review && event.kind != .issued { event.day = "1970-01-01" }
            events.append(event)
        }
        for row in try rows("SELECT * FROM cards ORDER BY id") {
            guard let id = row["id"], let front = row["front"], let back = row["back"] else { throw failure("旧卡片字段不完整") }
            let card = Card(id: id, front: front, back: back, example: row["example"], createdAt: row["created_at"].flatMap(Double.init))
            add(SyncEvent(kind: .edit, card: card), "card:\(id)")
        }
        for row in try rows("SELECT * FROM progress ORDER BY card_id") {
            guard let id = row["card_id"], let due = row["due"],
                  let ease = row["ease"].flatMap(Double.init),
                  let interval = row["interval"].flatMap(Int.init),
                  let repetitions = row["repetitions"].flatMap(Int.init) else { throw failure("旧学习进度字段不完整") }
            var progress = SchedulingState(cardId: id, due: due)
            progress.ease = ease; progress.interval = interval; progress.repetitions = repetitions
            progress.lastReviewedAt = row["last_reviewed_at"].flatMap(Double.init)
            add(SyncEvent(kind: .seed, progress: progress), "progress:\(id)")
        }
        for row in try rows("SELECT * FROM daily_stats ORDER BY date") {
            guard let day = row["date"] else { throw failure("旧统计日期缺失") }
            for field in ["added", "reviewed"] {
                guard let count = row[field].flatMap(Int.init), count >= 0 else { throw failure("旧统计数量无效") }
                var event = SyncEvent(kind: field == "added" ? .add : .review)
                event.day = day; event.count = count
                add(event, "stats:\(day):\(field)")
            }
        }
        let settings = Dictionary(uniqueKeysWithValues: try rows("SELECT * FROM settings").compactMap { row -> (String, String)? in
            guard let key = row["key"], let value = row["value"] else { return nil }; return (key, value)
        })
        if let limit = settings["new_cards_per_day"].flatMap(Int.init) { add(SyncEvent(kind: .studyConfig, limit: limit), "study") }
        for prefix in ["llm", "image"] {
            if settings["\(prefix)_base_url"] != nil {
                var config = APIConfig()
                config.baseURL = settings["\(prefix)_base_url"] ?? ""
                config.apiKey = settings["\(prefix)_api_key"] ?? ""
                config.model = settings["\(prefix)_model"] ?? ""
                add(SyncEvent(kind: prefix == "llm" ? .llmConfig : .imageConfig, config: config), prefix)
            }
        }
        if let day = settings["meta_new_cards_date"], let issued = settings["meta_new_cards_issued"].flatMap(Int.init), issued > 0 {
            for i in 0..<issued {
                var event = SyncEvent(kind: .issued, cardId: "legacy:\(source):issued:\(day):\(i)")
                event.day = day; add(event, "issued:\(day):\(i)")
            }
        }
        return events
    }
    static func failure(_ message: String) -> NSError {
        NSError(domain: "VibeWordMigration", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
