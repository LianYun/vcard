import AppKit
import Foundation
import UniformTypeIdentifiers

@MainActor
final class CloudBridge {
    static let shared = CloudBridge()
    let persistence: Persistence
    private let directory: URL
    private var migrated = false

    init(directory: URL? = nil) {
        let directory = directory ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vword")
        self.directory = directory
        persistence = Persistence(directory: directory.appendingPathComponent("library"),
                                  legacyURL: directory.appendingPathComponent("CloudLibrary.sqlite"), fixedICloud: true)

    }

    func prepare() async throws {
        try await persistence.open()
        if !migrated {
            let directory = directory
            try await persistence.perform { store in
                let sourceURL = directory.appendingPathComponent("migration-source")
                let source: String
                if FileManager.default.fileExists(atPath: sourceURL.path) {
                    source = try String(contentsOf: sourceURL, encoding: .utf8)
                    guard UUID(uuidString: source) != nil else { throw LegacyImport.failure("迁移标识无效") }
                } else {
                    source = UUID().uuidString
                    try source.write(to: sourceURL, atomically: true, encoding: .utf8)
                }
                let markerID = "legacy:\(source):complete"
                if !(try store.load()).contains(where: { $0.id == markerID }) {
                    try store.migrate(LegacyImport.events(at: directory.appendingPathComponent("vword.db").path, source: source), markerID: markerID)
                }
            }
            migrated = true
        }
    }

    func execute(_ request: Data) async throws -> Any {
        guard let json = try JSONSerialization.jsonObject(with: request) as? [String: Any], let command = json["command"] as? String else {
            throw LegacyImport.failure("无效的存储请求")
        }
        try await prepare()
        let args = json["args"] as? [String: Any] ?? [:]
        switch command {
        case "savePreferences":
            let limit = args["limit"] as? Int ?? -1
            guard (0...100).contains(limit), let enabled = args["enabled"] as? Bool else { throw OpenFormat.failure("学习设置无效") }
            let wasEnabled = persistence.iCloudEnabled
            try await persistence.setICloudEnabled(enabled)
            do {
                let directory = directory
                return try await persistence.perform { try Self.executeLocal(command: command, args: args, directory: directory, store: $0) }
            } catch { try? await persistence.setICloudEnabled(wasEnabled); throw error }
        case "chooseAnki", "chooseDocument", "importCards":
            let panel = NSOpenPanel(); panel.allowsMultipleSelection = false
            if command == "chooseAnki" { panel.allowedContentTypes = [UTType(filenameExtension: "apkg") ?? .data] }
            else if command == "importCards" { panel.allowedContentTypes = [.json, .commaSeparatedText] }
            else { panel.allowedContentTypes = [.pdf, .plainText, .commaSeparatedText, .json, UTType(filenameExtension: "jsonl") ?? .data, UTType(filenameExtension: "docx")!, UTType(filenameExtension: "md")!] }
            guard panel.runModal() == .OK, let url = panel.url else { return NSNull() }
            let directory = directory
            return try await persistence.perform { store -> Any in
                if command == "chooseAnki" {
                    let stage = directory.appendingPathComponent("anki-staging/" + UUID().uuidString)
                    try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
                    return ["path": url.path, "stage": stage.path]
                }
                let data = try FolderSync.readFile(url)
                if command == "importCards" {
                    let file = try url.pathExtension.lowercased() == "csv" ? TextImport.cardFile(data) : CardFile.decode(data)
                    let events = try file.changes(existing: store.load()); try store.append(events)
                    return events.filter { $0.kind == .add || $0.kind == .edit }.count
                }
                return try Self.importFile(data: data, name: url.lastPathComponent, directory: directory, store: store)
            }
        case "createBackup": return try await persistence.createBackup()
        case "exportCards":
            let panel = NSSavePanel(); panel.allowedContentTypes = [.json]; panel.nameFieldStringValue = "cards.json"
            guard panel.runModal() == .OK, let url = panel.url else { return NSNull() }
            let data = try await persistence.perform { try $0.exportCards() }
            try await EventWorkers.run(on: EventWorkers.sync) {
                let granted = url.startAccessingSecurityScopedResource()
                defer { if granted { url.stopAccessingSecurityScopedResource() } }
                try FolderSync.writeFile(data, to: url)
            }
        case "authorizeSync":
            let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.directoryURL = FolderSync.macCloudRoot; panel.message = L("请选择 iCloud Drive 根目录下的 VibeWordSync-v1 文件夹")
            guard panel.runModal() == .OK, let url = panel.url else { return NSNull() }
            try await persistence.authorizeICloudFolder(url)
            await persistence.synchronize(fullCheck: true)
            return status()
        case "status", "check":
            if command == "check" { await persistence.synchronize(fullCheck: true) }
            return status()
        default:
            let directory = directory
            return try await persistence.perform { try Self.executeLocal(command: command, args: args, directory: directory, store: $0) }
        }
        return NSNull()
    }
    private func status() -> [String: Any] {
        ["enabled": persistence.iCloudEnabled, "revision": persistence.snapshot.revision, "syncRevision": persistence.syncRevision,
         "needsAuthorization": persistence.needsICloudAuthorization,
         "message": persistence.syncStatus, "folder": persistence.folderName ?? ""]
    }
    // Only format validation falls back to AI; persistence/conflict errors must surface.
    nonisolated static func importFile(data: Data, name: String, directory: URL, store: JSONEventStore) throws -> Any {
        guard !data.isEmpty, data.count <= DocumentImport.maxBytes else { throw DocumentImport.failure("文档为空或超过 20 MB，请拆分后导入") }
        if let file = try? TextImport.structuredCards(data, name: name) {
            let events = try file.changes(existing: store.load())
            try store.append(events)
            return ["importedCount": events.filter { $0.kind == .add || $0.kind == .edit }.count]
        }
        let document = try DocumentImport.parse(data: data, name: name, imageDirectory: directory.appendingPathComponent("document-images"))
        return try JSONSerialization.jsonObject(with: JSONEncoder().encode(document))
    }
    nonisolated private static func executeLocal(command: String, args: [String: Any], directory: URL, store: JSONEventStore) throws -> Any {
        let started = Date()
        let library = try store.snapshot().library
        let snapshotMs = Date().timeIntervalSince(started) * 1000
        func decode<T: Decodable>(_ key: String, _: T.Type) throws -> T {
            guard let value = args[key] else { throw LegacyImport.failure("请求字段缺失：\(key)") }
            return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
        }
        func encode<T: Encodable>(_ value: T) throws -> Any {
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: [.fragmentsAllowed])
        }
        func append(_ events: [SyncEvent]) throws { if !events.isEmpty { try store.append(events) } }
        func studyConfig(_ limit: Int) throws -> SyncEvent {
            var event = SyncEvent(kind: .studyConfig, limit: limit)
            // Older clients changing only the limit must preserve the saved range.
            if args.keys.contains("studyScope") {
                let tags = try decode("studyScope", [String]?.self)
                if let tags, tags.isEmpty { throw OpenFormat.failure("请至少选择一个标签") }
                event.studyScope = StudyScope(tags: tags.map { Array(Set($0.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })).sorted() })
            }
            return event
        }
        switch command {
        case "schedulerConfig": return try encode(library.schedulerConfig)
        case "saveSchedulerConfig":
            let config = try decode("config", SchedulerConfig.self)
            try config.validate()
            guard try decode("expectedId", String.self) == library.schedulerConfig.id else { throw OpenFormat.failure("学习状态已变化，请重新检查") }
            var event = SyncEvent(kind: .fsrsConfig); event.schedulerConfig = config
            try append([event])
        case "rescheduleAll":
            guard try decode("configId", String.self) == library.schedulerConfig.id else { throw OpenFormat.failure("学习状态已变化，请重新检查") }
            _ = try store.createBackup()
            let states = FSRSScheduler.projection(Array(library.progress.values).filter { library.controls[$0.cardId]?.suspended != true }, history: library.reviews, config: library.schedulerConfig)
            try append(states.map { SyncEvent(kind: .reschedule, progress: $0) })
            return states.count
        case "decks": return try encode(library.decks)
        case "saveDeck": try append([library.saveDeckEvent(try decode("deck", Deck.self))])
        case "deleteDeck": try append(library.removeDeckEvents(try decode("id", String.self)))
        case "moveCards":
            let ids = Set(try decode("ids", [String].self)), deck = try decode("deckId", String.self)
            guard library.decks.contains(where: { $0.id == deck }) else { throw OpenFormat.failure("牌组不存在") }
            try append(library.cards.filter { ids.contains($0.id) }.map { card in var card = card; card.deckId = deck; return SyncEvent(kind: .edit, card: card) })
        case "media":
            let id = try decode("id", String.self)
            guard MediaStore.valid(id) else { throw OpenFormat.failure("附件标识无效") }
            let data = try OpenFormat.read(store.directory.appendingPathComponent("media").appendingPathComponent(id))
            guard OpenFormat.digest(data) == id.components(separatedBy: ".")[0] else { throw OpenFormat.failure("附件损坏") }
            return "data:" + MediaStore.mime(id) + ";base64," + data.base64EncodedString()
        case "pendingAnki":
            let folder = directory.appendingPathComponent("anki-staging")
            guard FileManager.default.fileExists(atPath: folder.path) else { return [] as [Any] }
            return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).compactMap { stage -> [String: Any]? in
                guard UUID(uuidString: stage.lastPathComponent) != nil, FileManager.default.fileExists(atPath: stage.appendingPathComponent("prepared.json").path) else { return nil }
                let prepared = try AnkiImport.read(stage)
                return ["stage": stage.path, "name": prepared.name, "count": prepared.cards.count, "decks": try encode(prepared.decks), "warnings": prepared.warnings, "mediaCount": prepared.mediaCount]
            }
        case "ankiModels":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory)
            let raw = try JSONDecoder().decode(RawAnki.self, from: Data(contentsOf: stage.appendingPathComponent("raw.json")))
            return raw.models.map { id, model in ["id": id, "name": model.name, "cloze": model.kind == 1, "fields": model.fields.sorted { $0.ord < $1.ord }.map(\.name)] as [String: Any] }
        case "prepareAnki":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory)
            let mappings = (try? decode("mappings", [String: [String: String]].self)) ?? [:]
            let prepared = try AnkiImport.prepare(stage: stage, mappings: mappings)
            return ["stage": stage.path, "name": prepared.name, "count": prepared.cards.count, "decks": try encode(prepared.decks), "warnings": prepared.warnings, "mediaCount": prepared.mediaCount]
        case "ankiPage":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory), offset = try decode("offset", Int.self)
            guard offset >= 0 else { throw OpenFormat.failure("分页无效") }
            return try encode(Array(AnkiImport.read(stage).cards.dropFirst(offset).prefix(20)))
        case "discardAnki":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory)
            try FileManager.default.removeItem(at: stage)
        case "ankiMedia":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory), id = try decode("id", String.self)
            guard MediaStore.valid(id) else { throw OpenFormat.failure("附件标识无效") }
            return "data:" + MediaStore.mime(id) + ";base64," + (try OpenFormat.read(stage.appendingPathComponent("media/" + id))).base64EncodedString()
        case "commitAnki":
            let stage = try AnkiImport.checkedStage(decode("stage", String.self), base: directory)
            let prepared = try AnkiImport.read(stage), offset = try decode("offset", Int.self)
            let selected = Set(try decode("deckIds", [String].self)), parent = args["parentId"] as? String
            guard offset >= 0, parent == nil || library.decks.contains(where: { $0.id == parent }) else { throw OpenFormat.failure("导入参数无效") }
            let incoming = Library(events: prepared.decks.map { deck in var e = SyncEvent(kind: .deck); e.deck = deck; return e })
            let selectedCards = prepared.cards.filter { card in selected.contains(where: { incoming.inDeck(card, $0) }) }
            let batch = Array(selectedCards.dropFirst(offset).prefix(100))
            if offset == 0 {
                // Copy immutable attachments before publishing any referring card events.
                for url in try FileManager.default.contentsOfDirectory(at: stage.appendingPathComponent("media"), includingPropertiesForKeys: nil) {
                    try MediaStore.install(OpenFormat.read(url), id: url.lastPathComponent, directory: store.directory)
                }
                let needed = Set(selectedCards.flatMap { incoming.deckAncestors($0.deckId ?? "default") })
                var events: [SyncEvent] = []
                for var deck in prepared.decks where needed.contains(deck.id) && !library.decks.contains(where: { $0.id == deck.id }) {
                    if deck.parentId == nil { deck.parentId = parent }
                    var event = SyncEvent(kind: .deck); event.deck = deck; events.append(event)
                }
                try append(events)
            }
            let prior = try store.load()
            let known = Set(prior.compactMap { $0.card?.id ?? $0.cardId })
            func sourceKey(_ note: AnkiNote) -> String { note.guid + ":" + note.model + ":" + String(note.ordinal) }
            let sources = Set(prior.compactMap { $0.card?.anki }.map(sourceKey))
            let fresh = batch.filter { !known.contains($0.id) && !($0.anki.map { sources.contains(sourceKey($0)) } ?? false) }
            try append(fresh.flatMap { [SyncEvent(kind: .add, card: $0), SyncEvent(kind: .seed, progress: SchedulingState(cardId: $0.id))] })
            return ["added": fresh.count, "skipped": batch.count - fresh.count, "next": offset + batch.count, "total": selectedCards.count, "done": offset + batch.count >= selectedCards.count]
        case "previewAnkiEdit":
            let id = try decode("id", String.self), fields = try decode("fields", [String: String].self)
            let events = try library.editAnkiEvents(id: id, fields: fields)
            return ["cards": try encode(events.compactMap(\.card)), "added": events.filter { $0.kind == .add }.count, "removed": events.filter { $0.kind == .delete }.count]
        case "saveEditedCard":
            let expected = try decode("expected", Card.self), draft = try decode("draft", Card.self)
            let fields = args["fields"] == nil ? nil : try decode("fields", [String: String].self)
            _ = try store.commit { library in try library.cardEditorEvents(expected: expected, draft: draft, fields: fields) }
            return true
        case "editAnkiNote":
            let id = try decode("id", String.self), fields = try decode("fields", [String: String].self)
            try append(library.editAnkiEvents(id: id, fields: fields))
        case "parseDocument":
            let name = try decode("name", String.self), base64 = try decode("data", String.self)
            guard base64.count <= (DocumentImport.maxBytes * 4 / 3 + 4), let data = Data(base64Encoded: base64) else {
                throw DocumentImport.failure("文档内容无效或超过 20 MB")
            }
            return try Self.importFile(data: data, name: name, directory: directory, store: store)
        case "importImage":
            let id = try decode("id", String.self)
            guard UUID(uuidString: id) != nil else { throw DocumentImport.failure("页面图片标识无效") }
            let url = directory.appendingPathComponent("document-images").appendingPathComponent(id + ".jpg")
            guard FileManager.default.fileExists(atPath: url.path) else { throw DocumentImport.failure("页面图片已丢失，请重新导入文档") }
            return "data:image/jpeg;base64," + (try Data(contentsOf: url)).base64EncodedString()
        case "aiTasks":
            let url = directory.appendingPathComponent("ai-tasks.json")
            guard FileManager.default.fileExists(atPath: url.path) else { return NSNull() }
            return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        case "saveAITasks":
            guard let state = args["state"] as? [String: Any], state["version"] as? Int == 1, state["tasks"] is [[String: Any]] else { throw OpenFormat.failure("任务队列格式无效，请备份后检查") }
            let data = try JSONSerialization.data(withJSONObject: state)
            guard data.count <= 50 * 1024 * 1024 else { throw OpenFormat.failure("导入草稿超过 50 MB，请删除旧任务后重试") }
            try data.write(to: directory.appendingPathComponent("ai-tasks.json"), options: [.atomic])
        case "confirmAIDraft":
            let card = try decode("card", Card.self), draftID = try decode("draftId", String.self)
            let expected = args["expected"] == nil || args["expected"] is NSNull ? nil : try decode("expected", Card.self)
            try append(AIConfirmation.events(existing: store.load(), draftID: draftID, card: card, expected: expected))
        case "importJobs":
            let url = directory.appendingPathComponent("document-imports.json")
            guard FileManager.default.fileExists(atPath: url.path) else { return [] as [Any] }
            return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        case "saveImportJobs":
            guard let jobs = args["jobs"] as? [[String: Any]] else { throw DocumentImport.failure("导入任务格式无效") }
            let data = try JSONSerialization.data(withJSONObject: jobs)
            guard data.count <= 50 * 1024 * 1024 else { throw DocumentImport.failure("导入草稿超过 50 MB，请删除旧任务后重试") }
            try data.write(to: directory.appendingPathComponent("document-imports.json"), options: [.atomic])
        case "acceptImportCards":
            let cards = try decode("cards", [Card].self)
            guard !cards.isEmpty, cards.count <= 2, Set(cards.map(\.id)).count == cards.count,
                  cards.allSatisfy({ $0.id.hasPrefix("custom:import:") && !$0.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !$0.back.isEmpty }) else {
                throw DocumentImport.failure("导入卡片格式无效")
            }
            let events = try store.load()
            // Every retry uses the same IDs. Never edit, resurrect, or seed an already accepted card.
            let known = Set(events.compactMap { $0.card?.id ?? $0.cardId })
            try append(cards.filter { !known.contains($0.id) }.flatMap {
                [SyncEvent(kind: .add, card: $0), SyncEvent(kind: .seed, progress: SchedulingState(cardId: $0.id))]
            })
        case "cards": return try encode(library.cards)
        case "progress": return try encode(library.progress)
        case "settings": return ["newCardsPerDay": library.newCardsPerDay, "studyScope": try encode(library.studyScope.tags)]
        case "meta": return ["newCardsDate": Day.key(), "newCardsIssued": library.issued[Day.key()]?.count ?? 0]
        case "llm": return try encode(library.llm)
        case "image": return try encode(library.image)
        case "stats":
            let from = try decode("from", String.self), to = try decode("to", String.self)
            return library.stats.keys.sorted().filter { $0 >= from && $0 <= to }.map {
                ["date": $0, "added": library.stats[$0]!.added, "reviewed": library.stats[$0]!.reviewed] as [String: Any]
            }
        case "saveCards":
            let cards = try decode("cards", [Card].self)
            let existing = Set(library.cards.map(\.id))
            // A deleted UUID must never be reused by a stale editor.
            let deleted = Set(Library.activeEvents(try store.load()).filter { $0.kind == .delete }.compactMap(\.cardId))
            guard cards.allSatisfy({ !deleted.contains($0.id) }) else { throw LegacyImport.failure("卡片已在另一台设备删除，请刷新") }
            try append(cards.flatMap { card in
                existing.contains(card.id) ? [SyncEvent(kind: .edit, card: card)] :
                    [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id))]
            })
        case "replaceRegeneratedCard":
            let expected = try decode("expected", Card.self), draft = try decode("draft", RegeneratedCard.self)
            _ = try store.commit { library in [try library.replaceRegeneratedCardEvent(expected: expected, draft: draft)] }
            return true
        case "updateCard":
            let id = try decode("id", String.self)
            guard var card = library.cards.first(where: { $0.id == id }) else { return false }
            card.front = try decode("front", String.self); card.back = try decode("back", String.self)
            card.example = args["example"] as? String
            if let tags = args["tags"] as? [String] { card.tags = tags }
            try append([SyncEvent(kind: .edit, card: card)]); return true
        case "deleteCard":
            let id = try decode("id", String.self)
            guard library.cards.contains(where: { $0.id == id }) else { return false }
            try append([SyncEvent(kind: .delete, cardId: id)]); return true
        case "seed":
            let states = try decode("states", [SchedulingState].self)
            try append(states.filter { state in library.progress[state.cardId] == nil && library.cards.contains(where: { $0.id == state.cardId }) }
                .map { SyncEvent(kind: .seed, progress: $0) })
        case "review":
            let id = try decode("id", String.self), quality = try decode("quality", Int.self)
            guard library.cards.contains(where: { $0.id == id }), let grade = ReviewGrade(rawValue: quality) else {
                throw LegacyImport.failure("卡片已被删除或评分无效，请重新检查学习队列")
            }
            guard library.controls[id]?.available() ?? true else { throw OpenFormat.failure("卡片已暂停或今天跳过") }
            let context = args["context"] == nil ? nil : try decode("context", ReviewContext.self)
            let now = try library.validateReviewContext(context, cardID: id)
            let event = library.reviewEvent(cardId: id, grade: grade, now: now)
            let card = library.cards.first { $0.id == id }!
            let siblings = library.siblingEvents(for: card, reviewID: event.id)
            try append([event] + siblings)
            var result = try encode(event.progress!) as! [String: Any]
            result["reviewId"] = event.id
            result["revision"] = try store.snapshot().revision
            result["controlUpdates"] = try encode(Dictionary(uniqueKeysWithValues: siblings.compactMap { event in
                guard let id = event.cardId, let control = event.control else { return nil as (String, CardControl)? }
                return (id, control)
            }))
            result["record"] = try encode(ReviewRecord(id: event.id, cardId: id, timestamp: event.timestamp * 1000,
                day: event.day, quality: quality, before: event.before!, after: event.progress!, algorithm: event.algorithm!, undone: false))
            return result
        case "backups":
            return try store.backupFiles().map { url in
                let snapshot = Library(events: try store.backupEvents(url.lastPathComponent))
                return ["name": url.lastPathComponent, "cards": snapshot.cards.count, "reviews": snapshot.stats.values.reduce(0) { $0 + $1.reviewed }] as [String: Any]
            }
        case "restoreBackup":
            try append([store.restoreEvent(try decode("name", String.self))])
        case "reviewHistory":
            let id = try decode("id", String.self)
            return try encode(Array(library.reviews.reversed().lazy.filter { $0.cardId == id }.prefix(20)))
        case "studyData":
            let migrationStart = Date()
            let ids = (args["ids"] as? [String]).map(Set.init)
            let controls = ids.map { ids in library.controls.filter { ids.contains($0.key) } } ?? library.controls
            let selected = ids.map { ids in library.progress.filter { ids.contains($0.key) } } ?? library.progress
            let histories = Dictionary(grouping: library.reviews, by: \.cardId)
            let progress = selected.mapValues { FSRSScheduler.migrate($0, history: histories[$0.cardId] ?? [], config: library.schedulerConfig) }
            StoreMetrics.record("studyData-migration", since: migrationStart, count: selected.count)
            return ["schedulerConfig": try encode(library.schedulerConfig), "controls": try encode(controls), "reviews": try encode((args["includeReviews"] as? Bool) == false ? [] : library.reviews),
                    "progress": try encode(progress), "issued": try encode(ids == nil ? library.issued : [:]), "deckIssued": try encode(ids == nil ? library.deckIssued : [:])]
        case "startStudy":
            let ahead = try decode("ahead", Int.self)
            guard (0...5).contains(ahead) else { throw OpenFormat.failure("提前学习天数必须为 1–5") }
            let scope = StudyScope(tags: try decode("scope", [String]?.self))
            let deckId = try decode("deckId", String?.self)
            let day = Day.key(), selectionStart = Date()
            var scoped = library
            if let deckId { scoped.cards = library.cards.filter { library.inDeck($0, deckId) } }
            var selected: [Card], reason: String, events: [SyncEvent]
            if ahead > 0 {
                selected = StudyEngine.ahead(cards: scoped.cards.filter(scope.matches), progress: library.progress, controls: library.controls, days: ahead, today: day)
                reason = "当前范围暂无待学卡片"; events = []
            } else {
                let selection = StudySelection.make(library: scoped, scope: scope, today: day)
                events = library.issueEvents(selection.fresh.map(\.id), day: day)
                let issued = Set(events.compactMap(\.cardId))
                selected = selection.reviews + selection.fresh.filter { issued.contains($0.id) }
                reason = selection.emptyReason
            }
            let selectionMs = Date().timeIntervalSince(selectionStart) * 1000
            let commitStart = Date()
            try append(events)
            let next = try store.snapshot().library
            let commitMs = Date().timeIntervalSince(commitStart) * 1000
            let responseStart = Date()
            // Direct lookups avoid scanning the full progress map again.
            let states = Dictionary(uniqueKeysWithValues: selected.compactMap { card in next.progress[card.id].map { (card.id, $0) } })
            let legacyIds = Set(states.filter { $0.value.fsrs?.version != 6 || $0.value.fsrs?.parametersId != next.schedulerConfig.id }.keys)
            let histories = legacyIds.isEmpty ? [:] : Dictionary(grouping: next.reviews.filter { legacyIds.contains($0.cardId) }, by: \.cardId)
            let progress = states.mapValues { FSRSScheduler.migrate($0, history: histories[$0.cardId] ?? [], config: next.schedulerConfig) }
            let migrationMs = Date().timeIntervalSince(responseStart) * 1000
            let encodeStart = Date()
            let controls = Dictionary(uniqueKeysWithValues: selected.compactMap { card in next.controls[card.id].map { (card.id, $0) } })
            let data: [String: Any] = ["schedulerConfig": try encode(next.schedulerConfig), "progress": try encode(progress), "controls": try encode(controls), "reviews": [], "issued": [:], "deckIssued": [:]]
            let cards = try encode(selected)
            return ["cards": cards, "data": data, "emptyReason": reason,
                    "timings": ["snapshotMs": snapshotMs, "selectionMs": selectionMs, "commitMs": commitMs,
                                "migrationMs": migrationMs, "encodeMs": Date().timeIntervalSince(encodeStart) * 1000,
                                "responseMs": Date().timeIntervalSince(responseStart) * 1000, "nativeMs": Date().timeIntervalSince(started) * 1000]]
        case "control":
            let id = try decode("id", String.self)
            guard library.cards.contains(where: { $0.id == id }) else { throw OpenFormat.failure("卡片已删除") }
            var event = SyncEvent(kind: .cardControl, cardId: id)
            event.control = try decode("control", CardControl.self)
            try append([event])
        case "undoReview":
            let id = try decode("id", String.self)
            try append([library.undoEvent(id)])
        case "issue":
            let ids = try decode("ids", [String].self)
            let events = library.issueEvents(ids)
            try append(events)
            return events.compactMap(\.cardId)
        case "saveSettings": try append([studyConfig(try decode("limit", Int.self))])
        case "saveLLM", "saveImage":
            try append([SyncEvent(kind: command == "saveLLM" ? .llmConfig : .imageConfig, config: try decode("config", APIConfig.self))])
        case "savePreferences":
            try append([studyConfig(try decode("limit", Int.self)), SyncEvent(kind: .llmConfig, config: try decode("llm", APIConfig.self).trimmed()), SyncEvent(kind: .imageConfig, config: try decode("image", APIConfig.self).trimmed())])
        default: throw LegacyImport.failure("不支持的存储操作")
        }
        return NSNull()
    }

}

// Called only on Tauri's blocking worker pool. JSON storage and AppKit stay on the
// storage worker; AppKit dialogs stay on MainActor. The JSON result is owned by Rust until vibe_cloud_free is called.
@_cdecl("vibe_cloud_request")
public func vibeCloudRequest(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let data = Data(String(cString: request).utf8)
    let semaphore = DispatchSemaphore(value: 0)
    var response = "{}"
    Task { @MainActor in
        do {
            let value = try await CloudBridge.shared.execute(data)
            response = String(decoding: try JSONSerialization.data(withJSONObject: ["value": value]), as: UTF8.self)
        } catch {
            response = String(decoding: (try? JSONSerialization.data(withJSONObject: ["error": error.localizedDescription])) ?? Data(), as: UTF8.self)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return strdup(response)
}
@_cdecl("vibe_cloud_free")
public func vibeCloudFree(_ response: UnsafeMutablePointer<CChar>) { free(response) }
