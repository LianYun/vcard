import Foundation
import CryptoKit

// Two serial executors shared by Mac and iOS. File I/O never runs on MainActor.
private final class QueuedOperation<T>: @unchecked Sendable {
    // Ownership transfers to the serial executor; the caller only awaits its result.
    let operation: () throws -> T
    init(_ operation: @escaping () throws -> T) { self.operation = operation }
}
public enum EventWorkers {
    public static let local = DispatchQueue(label: "vibe-word.storage", qos: .userInitiated)
    public static let sync = DispatchQueue(label: "vibe-word.sync", qos: .utility)
    public static func run<T>(on queue: DispatchQueue = local, _ operation: @escaping () throws -> T) async throws -> T {
        let work = QueuedOperation(operation)
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try work.operation() }) }
        }
    }
}
public enum StoreMetrics {
    public static func record(_ operation: String, since start: Date, count: Int = 0) {
        let milliseconds = Date().timeIntervalSince(start) * 1000
        if milliseconds >= 25 { NSLog("VibeWord perf %@ count=%d ms=%.1f", operation, count, milliseconds) }
    }
}
public struct StoreSnapshot: Sendable {
    public let revision: Int
    public let library: Library
}
public struct CommitResult: Sendable {
    public let snapshot: StoreSnapshot
    public let events: [SyncEvent]
}
public struct ExportFile: Sendable {
    public let name: String
    public let data: Data
}

public enum OpenFormat {
    public static func failure(_ message: String) -> NSError {
        NSError(domain: "VibeWordJSON", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }
    public static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    public static func read(_ url: URL) throws -> Data {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 32_000_000 else { throw failure("JSON 文件超过 32 MB：\(url.lastPathComponent)") }
        let data = try Data(contentsOf: url)
        guard data.count <= 32_000_000 else { throw failure("JSON 文件超过 32 MB") }
        return data
    }
    private final class DayValidator {
        let formatter = DateFormatter()
        var results: [String: Bool] = [:]
        init() {
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        }
    }
    static func validDay(_ value: String) -> Bool {
        // Preserve strict calendar validation, memoizing repeated dates per worker.
        let key = "VibeWord.OpenFormat.dayValidator"
        let validator: DayValidator
        if let cached = Thread.current.threadDictionary[key] as? DayValidator { validator = cached }
        else { validator = DayValidator(); Thread.current.threadDictionary[key] = validator }
        if let valid = validator.results[value] { return valid }
        let valid = value.count == 10 && validator.formatter.date(from: value).map { validator.formatter.string(from: $0) == value } == true
        if validator.results.count >= 4096 { validator.results.removeAll(keepingCapacity: true) }
        validator.results[value] = valid
        return valid
    }
    static func validate(_ card: Card) throws {
        guard !card.id.isEmpty, card.id.utf8.count <= 512,
              !card.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              card.noteId.map({ !$0.isEmpty && $0.utf8.count <= 512 }) ?? true,
              card.createdAt.map({ $0.isFinite && $0 >= 0 }) ?? true else { throw failure("卡片 ID、正面或时间无效") }
    }
    static func validate(_ event: SyncEvent) throws {
        guard !event.id.isEmpty, event.id.utf8.count <= 1024, event.timestamp.isFinite, event.timestamp >= 0,
              validDay(event.day), event.count.map({ $0 >= 0 && $0 <= 100_000_000 }) ?? true else { throw failure("事件 ID、时间或统计无效") }
        if let card = event.card { try validate(card) }
        if let deckIds = event.deckIds { guard deckIds.count <= 1000, deckIds.allSatisfy({ !$0.isEmpty }) else { throw failure("牌组额度记录无效") } }
        for state in [event.progress, event.before].compactMap({ $0 }) {
            guard !state.cardId.isEmpty, state.ease.isFinite, state.ease >= 1.3,
                  state.interval >= 0, state.interval < 1_000_000, state.repetitions >= 0,
                  validDay(state.due), state.lastReviewedAt.map({ $0.isFinite && $0 >= 0 }) ?? true else { throw failure("学习进度无效") }
        }
        if let quality = event.quality { guard ReviewGrade(rawValue: quality) != nil, event.before != nil, event.before?.cardId == event.progress?.cardId else { throw failure("评分记录无效") } }
        for state in [event.progress, event.before].compactMap({ $0 }) {
            guard state.learningDue.map({ $0.isFinite && $0 >= 0 }) ?? true,
                  state.issuedAt.map(validDay) ?? true,
                  state.phase.map({ ["new", "learning", "review", "relearning"].contains($0) }) ?? true else { throw failure("重学状态无效") }
        }
        if let config = event.schedulerConfig { try config.validate() }
        for state in [event.progress, event.before].compactMap({ $0 }) {
            if let m = state.fsrs { guard m.version == 6, m.stability.isFinite, (0.001...36500).contains(m.stability), m.difficulty.isFinite, (1...10).contains(m.difficulty), m.lapses >= 0, !m.parametersId.isEmpty else { throw failure("FSRS 记忆状态无效") } }
        }
        switch event.kind {
        case .fsrsConfig: guard event.schedulerConfig != nil else { throw failure("复习算法配置无效") }
        case .reschedule: guard event.progress?.fsrs != nil else { throw failure("FSRS 记忆状态无效") }
        case .deck:
            guard let deck = event.deck, !deck.id.isEmpty, !deck.name.isEmpty, deck.parentId != deck.id, deck.newCardsPerDay.map({ $0 >= 0 && $0 <= 100_000 }) ?? true else { throw failure("牌组无效") }
        case .deleteDeck: guard event.targetId != nil && event.targetId != "default" else { throw failure("牌组删除无效") }
        case .add: guard event.card != nil || event.count != nil else { throw failure("新增事件缺少卡片") }
        case .edit: guard event.card != nil else { throw failure("编辑事件缺少卡片") }
        case .delete, .issued: guard let id = event.cardId, !id.isEmpty else { throw failure("事件缺少卡片 ID") }
        case .review: guard event.progress != nil || event.count != nil else { throw failure("评分事件缺少进度") }
        case .studyConfig: guard let limit = event.limit, limit >= 0, limit <= 100_000 else { throw failure("学习设置无效") }
        case .llmConfig, .imageConfig: guard event.config != nil else { throw failure("模型配置缺失") }
        case .restore:
            guard let events = event.restoredEvents, events.count <= 100_000,
                  events.allSatisfy({ $0.kind != .restore }) else { throw failure("恢复快照无效") }
            for item in events { try validate(item) }
        case .undoReview:
            guard event.cardId != nil, event.targetId?.isEmpty == false else { throw failure("撤销事件无效") }
        case .cardControl:
            guard event.cardId != nil, let control = event.control,
                  control.buriedUntil.map(validDay) ?? true else { throw failure("卡片状态无效") }
        case .seed: break // Also used for idempotent migration markers.
        }
    }
}

public struct EventFile: Codable {
    public var format = "vibe-word.events"
    public var version = 4
    public var events: [SyncEvent]
    public init(events: [SyncEvent]) { self.events = events }
    public static func decode(_ data: Data) throws -> EventFile {
        let file = try JSONDecoder().decode(Self.self, from: data)
        guard file.format == "vibe-word.events", (1...4).contains(file.version), file.events.count <= 100_000 else {
            throw OpenFormat.failure("不支持的事件文件格式或版本")
        }
        for event in file.events {
            try OpenFormat.validate(event)
        }
        return file
    }
    public var shareable: EventFile {
        EventFile(events: events.filter { $0.kind != .seed || $0.progress != nil })
    }
}

/// Open interchange format. Stable IDs make repeat imports update rather than duplicate.
public struct CardFile: Codable {
    public var format = "vibe-word.cards"
    public var version = 1
    public var cards: [Card]
    public init(cards: [Card]) { self.cards = cards }
    public static func decode(_ data: Data) throws -> CardFile {
        let file = try JSONDecoder().decode(Self.self, from: data)
        guard file.format == "vibe-word.cards", file.version == 1, file.cards.count <= 100_000 else {
            throw OpenFormat.failure("不支持的卡片文件格式或版本")
        }
        var ids = Set<String>()
        for card in file.cards {
            try OpenFormat.validate(card)
            guard ids.insert(card.id).inserted else { throw OpenFormat.failure("导入文件包含重复卡片 ID") }
        }
        return file
    }
    public func changes(existing: [SyncEvent]) throws -> [SyncEvent] {
        let library = Library(events: existing)
        let current = Dictionary(uniqueKeysWithValues: library.cards.map { ($0.id, $0) })
        let deleted = Set(Library.activeEvents(existing).filter { $0.kind == .delete }.compactMap(\.cardId))
        var result: [SyncEvent] = []
        for var card in cards {
            guard !deleted.contains(card.id) else { throw OpenFormat.failure("卡片 \(card.id) 已删除；恢复请使用新 ID") }
            if let old = current[card.id] {
                card.createdAt = old.createdAt
                if card != old { result.append(SyncEvent(kind: .edit, card: card)) }
            } else {
                card.createdAt = card.createdAt ?? Date().timeIntervalSince1970
                result += [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id))]
            }
        }
        return result
    }
}

/// One atomic JSON file per transaction; immutable files are safe to exchange
/// through file providers. The materialized library is rebuilt by the shared reducer.
// Immutable directory; the lock serializes local reads/transactions with background sync.
public final class JSONEventStore: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    public let directory: URL
    private var cachedEvents: [SyncEvent]?
    private var exports: [String: Data] = [:]
    private var eventBytes: [String: Data] = [:]
    private var cachedLibrary: Library?
    private var lastEvent: SyncEvent?
    private var revision = 0
    private var backupDay: String?
    public var onBackupResult: (@Sendable (String?) -> Void)?

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("events"), withIntermediateDirectories: true)
    }
    public func files() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("events"),
            includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
            .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
    public func load() throws -> [SyncEvent] {
        lock.lock(); defer { lock.unlock() }
        if let cachedEvents { return cachedEvents }
        let start = Date(); defer { StoreMetrics.record("load", since: start, count: cachedEvents?.count ?? 0) }
        var seen: [String: Data] = [:]
        var result: [SyncEvent] = []
        for url in try files() {
            let file = try EventFile.decode(OpenFormat.read(url))
            if !file.shareable.events.isEmpty {
                let data = try OpenFormat.encode(file.shareable)
                exports[OpenFormat.digest(data) + ".json"] = data
            }
            for event in file.events {
                let data = try OpenFormat.encode(event)
                if let prior = seen[event.id] {
                    guard prior == data else { throw OpenFormat.failure("同一事件 ID 的内容冲突：\(url.lastPathComponent)") }
                } else { seen[event.id] = data; result.append(event) }
            }
        }
        eventBytes = seen; cachedEvents = result
        lastEvent = result.max(by: Self.precedes)
        return result
    }
    private static func precedes(_ a: SyncEvent, _ b: SyncEvent) -> Bool {
        a.timestamp == b.timestamp ? a.id < b.id : a.timestamp < b.timestamp
    }
    public func snapshot() throws -> StoreSnapshot {
        lock.lock(); defer { lock.unlock() }
        if cachedLibrary == nil {
            let start = Date()
            cachedLibrary = Library(events: try load())
            StoreMetrics.record("projection", since: start, count: cachedEvents?.count ?? 0)
        }
        return StoreSnapshot(revision: revision, library: cachedLibrary!)
    }
    public func commit(_ make: (Library) throws -> [SyncEvent]) throws -> CommitResult {
        lock.lock(); defer { lock.unlock() }
        let start = Date(); defer { StoreMetrics.record("commit", since: start) }
        let events = try make(snapshot().library)
        try append(events)
        return CommitResult(snapshot: try snapshot(), events: events)
    }
    public func exportSnapshot() throws -> [ExportFile] {
        lock.lock(); defer { lock.unlock() }
        _ = try load()
        return exports.map { ExportFile(name: $0.key, data: $0.value) }
    }

    public func invalidate() {
        lock.lock(); defer { lock.unlock() }
        cachedEvents = nil; cachedLibrary = nil; eventBytes = [:]; exports = [:]; lastEvent = nil
        revision += 1
    }
    @discardableResult public func append(_ events: [SyncEvent]) throws -> Bool {
        try appendBatches([events])
    }
    /// Validate all incoming transactions against one local snapshot. Keep file-size
    /// boundaries and reject conflicts before committing any of the incoming batches.
    @discardableResult public func appendBatches(_ batches: [[SyncEvent]]) throws -> Bool {
        lock.lock(); defer { lock.unlock() }
        let existing = try load()
        var pending: [String: Data] = [:]
        var writes: [(Data, [SyncEvent])] = []
        for events in batches {
            var fresh: [SyncEvent] = []
            for event in events {
                try OpenFormat.validate(event)
                let data = try OpenFormat.encode(event)
                if let prior = pending[event.id] ?? eventBytes[event.id] {
                    guard prior == data else { throw OpenFormat.failure("同一事件 ID 不允许修改内容") }
                } else { pending[event.id] = data; fresh.append(event) }
            }
            guard !fresh.isEmpty else { continue }
            let data = try OpenFormat.encode(EventFile(events: fresh))
            guard data.count <= 32_000_000 else { throw OpenFormat.failure("单次保存超过 32 MB，请分批操作") }
            writes.append((data, fresh))
        }
        guard !writes.isEmpty else { return false }
        if !existing.isEmpty && !existing.contains(where: { $0.algorithm == FSRSScheduler.algorithm }) && writes.contains(where: { $0.1.contains(where: { $0.algorithm == FSRSScheduler.algorithm }) }) { _ = try createBackup(events: existing) }
        if !existing.isEmpty && backupDay != Day.key() {
            backupDay = Day.key()
            let snapshot = existing, day = backupDay!
            EventWorkers.sync.async { [self] in
                do { try automaticBackup(snapshot, day: day); onBackupResult?(nil) }
                catch {
                    lock.lock(); if backupDay == day { backupDay = nil }; lock.unlock()
                    onBackupResult?(error.localizedDescription)
                }
            }
        }
        do {
            for (data, fresh) in writes {
                let url = directory.appendingPathComponent("events/\(OpenFormat.digest(data)).json")
                try data.write(to: url, options: .atomic)
                // Publish each successfully written transaction even if a later write fails.
                let shared = EventFile(events: fresh).shareable
                if !shared.events.isEmpty {
                    let bytes = try OpenFormat.encode(shared)
                    exports[OpenFormat.digest(bytes) + ".json"] = bytes
                }
                cachedEvents!.append(contentsOf: fresh)
                for event in fresh { eventBytes[event.id] = pending[event.id] }
                let ordered = fresh.sorted(by: Self.precedes)
                let cardIDs = Set(cachedLibrary?.cards.map(\.id) ?? [])
                let incremental = cachedLibrary != nil && ordered.allSatisfy { event in
                    [.review, .seed, .issued, .cardControl, .studyConfig, .llmConfig, .imageConfig].contains(event.kind)
                        && (event.progress.map { cardIDs.contains($0.cardId) } ?? true)
                        && (event.kind != .issued || event.cardId.map { cardIDs.contains($0) } == true)
                } && (lastEvent.map { previous in ordered.first.map { Self.precedes(previous, $0) } == true } ?? true)
                if incremental { cachedLibrary?.applyStudyEvents(ordered) } else { cachedLibrary = nil }
                if let newest = ordered.last, lastEvent.map({ Self.precedes($0, newest) }) ?? true { lastEvent = newest }
                revision += 1
            }
        } catch { invalidate(); throw error }

        return true
    }
    // Migrations may contain years of images/history. Commit bounded batches and
    // write the completion marker last; stable event IDs make interrupted retries safe.
    public func migrate(_ events: [SyncEvent], markerID: String) throws {
        lock.lock(); defer { lock.unlock() }
        guard !(try load()).contains(where: { $0.id == markerID }) else { return }
        for event in events { try OpenFormat.validate(event) }
        var batch: [SyncEvent] = []
        var size = 0
        for event in events {
            let bytes = try OpenFormat.encode(event).count
            if !batch.isEmpty && (size + bytes > 16_000_000 || batch.count >= 10_000) {
                try append(batch); batch = []; size = 0
            }
            batch.append(event); size += bytes
        }
        try append(batch)
        var marker = SyncEvent(kind: .seed); marker.id = markerID
        try append([marker])
    }
    @discardableResult public func importCards(_ data: Data) throws -> Int {
        lock.lock(); defer { lock.unlock() }
        let file = try CardFile.decode(data)
        let events = try file.changes(existing: load())
        try append(events)
        return events.filter { $0.kind == .add || $0.kind == .edit }.count
    }
    public func exportCards() throws -> Data { try OpenFormat.encode(CardFile(cards: Library(events: load()).cards)) }
}

public extension JSONEventStore {
    func backupFiles() throws -> [URL] {
        let folder = directory.appendingPathComponent("backups")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
    }
    func automaticBackup(_ events: [SyncEvent], day: String = Day.key()) throws {
        let file = directory.appendingPathComponent("backups/auto-\(day).json")
        _ = try backupFiles()
        guard !FileManager.default.fileExists(atPath: file.path) else { return }
        try backupMedia(name: file.lastPathComponent)
        try OpenFormat.encode(EventFile(events: Library.activeEvents(events))).write(to: file, options: .atomic)
        let automatic = try backupFiles().filter { $0.lastPathComponent.hasPrefix("auto-") }
        for old in automatic.dropFirst(14) {
            try FileManager.default.removeItem(at: old)
            let media = directory.appendingPathComponent("backups/" + old.lastPathComponent + ".media")
            if FileManager.default.fileExists(atPath: media.path) { try FileManager.default.removeItem(at: media) }
        }
    }
    @discardableResult func createBackup(events: [SyncEvent]? = nil) throws -> String {
        let snapshot: [SyncEvent]
        if let events { snapshot = events }
        else { lock.lock(); defer { lock.unlock() }; snapshot = try load() }
        _ = try backupFiles()
        let name = "manual-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString).json"
        try backupMedia(name: name)
        try OpenFormat.encode(EventFile(events: Library.activeEvents(snapshot)))
            .write(to: directory.appendingPathComponent("backups/" + name), options: .atomic)
        return name
    }
    func backupEvents(_ name: String) throws -> [SyncEvent] {
        guard let file = try backupFiles().first(where: { $0.lastPathComponent == name }) else { throw OpenFormat.failure("找不到备份") }
        return try EventFile.decode(OpenFormat.read(file)).events
    }
    func restoreEvent(_ name: String) throws -> SyncEvent {
        lock.lock(); defer { lock.unlock() }
        let events = try backupEvents(name)
        let media = directory.appendingPathComponent("backups/" + name + ".media")
        if FileManager.default.fileExists(atPath: media.path) {
            for url in try FileManager.default.contentsOfDirectory(at: media, includingPropertiesForKeys: nil) where MediaStore.valid(url.lastPathComponent) {
                try MediaStore.install(OpenFormat.read(url), id: url.lastPathComponent, directory: directory)
            }
        }
        _ = try createBackup()
        var event = SyncEvent(kind: .restore)
        event.restoredEvents = Library.activeEvents(events)
        return event
    }
}

public extension JSONEventStore {
    func backupMedia(name: String) throws {
        let source = directory.appendingPathComponent("media"), target = directory.appendingPathComponent("backups/" + name + ".media")
        guard FileManager.default.fileExists(atPath: source.path) else { return }
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        for url in try FileManager.default.contentsOfDirectory(at: source, includingPropertiesForKeys: nil) where MediaStore.valid(url.lastPathComponent) {
            let destination = target.appendingPathComponent(url.lastPathComponent)
            if !FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.copyItem(at: url, to: destination) }
        }
    }
}
