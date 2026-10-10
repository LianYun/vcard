import Foundation
import Combine

@MainActor
final class Persistence: ObservableObject {
    nonisolated static var isLocalPreview: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-local-preview")
        #else
        return false
        #endif
    }
    @Published private(set) var ready = false
    @Published private(set) var syncStatus = "正在打开 JSON 文件…"
    @Published private(set) var folderName: String?
    @Published private(set) var iCloudEnabled = false
    var needsICloudAuthorization: Bool { folderSync?.needsAuthorization ?? true }
    @Published var error: String?
    var onChange: (() -> Void)?
    private(set) var syncRevision = 0
    private(set) var snapshot = StoreSnapshot(revision: -1, library: Library())
    private var opening: Task<Void, Never>?
    private var pendingSync = false
    private var pendingFullCheck = false
    private var firstDirtyAt: Date?
    @Published private(set) var backupError: String?
    private(set) var store: JSONEventStore?
    private var folderSync: FolderSync?
    private let fixedICloud: Bool
    private var syncing = false
    private var timer: Timer?
    private var scheduled: Task<Void, Never>?

    init(directory: URL? = nil, legacyURL: URL? = nil, fixedICloud: Bool = false) {
        self.fixedICloud = fixedICloud
        opening = Task { [weak self] in
            guard let self else { return }
            do {
                let requestedDirectory = directory
                let store = try await EventWorkers.run { [self] in
                    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    var defaultDirectory = documents.appendingPathComponent("VibeWord", isDirectory: true)
                    #if DEBUG && targetEnvironment(simulator)
                    if Self.isLocalPreview {
                        defaultDirectory = documents.appendingPathComponent("VibeWordPreview", isDirectory: true)
                        if let raw = ProcessInfo.processInfo.environment["VIBE_TEST_STORE"], let id = UUID(uuidString: raw) {
                            defaultDirectory = documents.appendingPathComponent("UITest-\(id.uuidString)", isDirectory: true)
                        }
                    }
                    #endif
                    let directory = requestedDirectory ?? defaultDirectory
                    let store = try JSONEventStore(directory: directory)
                    store.onBackupResult = { [weak self] message in Task { @MainActor in self?.backupError = message } }
                    #if DEBUG && targetEnvironment(simulator)
                    // Seed isolated UI-test stores once; relaunch must retain edits and deletions.
                    if Self.isLocalPreview,
                       let raw = ProcessInfo.processInfo.environment["VIBE_TEST_STORE"], UUID(uuidString: raw) != nil,
                       let fixture = ProcessInfo.processInfo.environment["VIBE_TEST_CARDS"],
                       try store.load().isEmpty {
                        let cards = try JSONDecoder().decode([Card].self, from: Data(fixture.utf8))
                        _ = try store.append(cards.flatMap { card in
                            [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id))]
                        })
                    }
                    #endif
                    // A normal iOS install migrates its old default Core Data file, read-only.
                    let legacy = legacyURL ?? (directory == defaultDirectory && !Self.isLocalPreview
                        ? LegacyCoreDataImport.defaultURL : nil)
                    let markerID = "migration:coredata-json-v1"
                    if let legacy, !(try store.load()).contains(where: { $0.id == markerID }) {
                        try store.migrate(LegacyCoreDataImport.load(at: legacy), markerID: markerID)
                    }
                    _ = try store.snapshot() // Validate before presenting the local library.
                    return store
                }
                self.store = store
                snapshot = try await EventWorkers.run { try store.snapshot() }
                ready = true
                onChange?()
                do {
                    folderSync = try await EventWorkers.run(on: EventWorkers.sync) {
                        #if os(macOS)
                        return try FolderSync(directory: store.directory, fixedCloudRoot: fixedICloud ? FolderSync.macCloudRoot : nil)
                        #else
                        return try FolderSync(directory: store.directory, requiresFixedFolder: fixedICloud)
                        #endif
                    }
                } catch { syncStatus = fixedICloud ? "iCloud 配置无法读取；本地数据可用" : "文件夹授权失效，请重新选择；本地数据可用" }
                iCloudEnabled = folderSync?.iCloudEnabled ?? false
                folderName = folderSync?.folder.map { fixedICloud ? "iCloud Drive / VibeWordSync-v1" : $0.lastPathComponent }
                if folderSync != nil { syncStatus = folderName == nil ? (fixedICloud ? "仅使用本地数据" : "本地 JSON · 尚未选择同步文件夹") : "已连接 \(folderName!)；等待同步" }
                if fixedICloud && iCloudEnabled && needsICloudAuthorization { syncStatus = "请授权固定的 iCloud 目录" }
                if !Self.isLocalPreview {
                    timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
                        Task { @MainActor in await self?.synchronize() }
                    }
                    Task { [weak self] in await self?.synchronize() }
                }
            } catch { self.error = "无法打开数据：\(error.localizedDescription)" }
        }
    }
    func open() async throws {
        await opening?.value
        guard ready else { throw OpenFormat.failure(error ?? "数据尚未就绪") }
    }
    // All operations execute on the serial storage worker; UI receives only values.
    func perform<T>(_ operation: @escaping (JSONEventStore) throws -> T) async throws -> T {
        try await open()
        guard let store else { throw OpenFormat.failure("数据尚未就绪") }
        let (result, next) = try await EventWorkers.run { (try operation(store), try store.snapshot()) }
        let changed = next.revision > snapshot.revision
        publish(next)
        if changed { scheduleSync() }
        return result
    }
    private func publish(_ next: StoreSnapshot) {
        guard next.revision > snapshot.revision else { return }
        snapshot = next; onChange?()
    }
    private func publishImported(_ next: StoreSnapshot) {
        syncRevision = max(syncRevision, next.revision)
        publish(next)
    }
    func load() async throws -> [SyncEvent] { try await perform { try $0.load() } }
    @discardableResult func commit(_ make: @escaping (Library) throws -> [SyncEvent]) async throws -> CommitResult {
        let result = try await perform { try $0.commit(make) }
        if !result.events.isEmpty { scheduleSync() }
        return result
    }
    func append(_ events: [SyncEvent]) async throws { _ = try await commit { _ in events } }
    func review(_ id: String, grade: ReviewGrade, context: ReviewContext? = nil) async throws -> CommitResult {
        try await commit { library in
            guard let card = library.cards.first(where: { $0.id == id }), library.controls[id]?.available() ?? true else {
                throw OpenFormat.failure("卡片已删除或已暂停，请重新检查学习队列")
            }
            let now = try library.validateReviewContext(context, cardID: id)
            let event = library.reviewEvent(cardId: id, grade: grade, now: now)
            return [event] + library.siblingEvents(for: card, reviewID: event.id)
        }
    }
    func rescheduleFSRS(_ expectedID: String) async throws -> Int {
        let result = try await perform { store in
            _ = try store.createBackup()
            return try store.commit { library in
                guard library.schedulerConfig.id == expectedID else { throw OpenFormat.failure("学习状态已变化，请重新检查") }
                return FSRSScheduler.projection(Array(library.progress.values).filter { library.controls[$0.cardId]?.suspended != true }, history: library.reviews, config: library.schedulerConfig).map { SyncEvent(kind: .reschedule, progress: $0) }
            }
        }
        publish(result.snapshot); scheduleSync(); return result.events.count
    }
    private func scheduleSync() {
        let first = firstDirtyAt ?? Date(); firstDirtyAt = first
        scheduled?.cancel()
        let delay = max(0, min(2, 10 - Date().timeIntervalSince(first)))
        scheduled = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            self?.firstDirtyAt = nil
            await self?.synchronize()
        }
    }
    func createBackup() async throws -> String {
        let events = try await load()
        guard let store else { throw OpenFormat.failure("数据尚未就绪") }
        return try await EventWorkers.run(on: EventWorkers.sync) { try store.createBackup(events: events) }
    }
    func authorizeICloudFolder(_ url: URL) async throws {
        guard let folderSync else { throw OpenFormat.failure("iCloud 配置无法读取；本地数据可用") }
        try await folderSync.configure { try $0.authorizeICloudFolder(url) }
    }
    func setICloudEnabled(_ enabled: Bool) async throws {
        guard fixedICloud, let folderSync else { throw OpenFormat.failure("iCloud 配置无法读取；本地数据可用") }
        try await folderSync.configure { try $0.setICloudEnabled(enabled) }
        iCloudEnabled = enabled
        folderName = enabled ? "iCloud Drive / VibeWordSync-v1" : nil
        syncStatus = enabled ? "已连接 iCloud Drive / VibeWordSync-v1；等待同步" : "仅使用本地数据"
    }
    func connectFolder(_ url: URL) async throws {
        guard !fixedICloud else { throw OpenFormat.failure("iCloud 目录不可更改") }
        guard let store else { throw OpenFormat.failure("数据尚未就绪") }
        if folderSync == nil {
            // Remove a stale bookmark only after the user explicitly selects a replacement.
            let bookmark = store.directory.appendingPathComponent("sync-folder.bookmark")
            folderSync = try await EventWorkers.run(on: EventWorkers.sync) {
                if FileManager.default.fileExists(atPath: bookmark.path) { try FileManager.default.removeItem(at: bookmark) }
                return try FolderSync(directory: store.directory)
            }
        }
        try await folderSync?.configure { try $0.connect(url) }
        folderName = url.lastPathComponent
        syncStatus = "已连接 \(url.lastPathComponent)"
    }
    func disconnectFolder() async throws {
        try await folderSync?.configure { try $0.disconnect() }
        folderName = nil
        syncStatus = "已断开同步文件夹；本地和云端文件均保留"
    }
    func synchronize(fullCheck: Bool = false) async {
        guard ready else { return }
        if syncing { pendingSync = true; pendingFullCheck = pendingFullCheck || fullCheck; return }
        guard let store, let folderSync, folderSync.isConnected else { return }
        syncing = true
        defer {
            syncing = false
            if pendingSync {
                let full = pendingFullCheck; pendingSync = false; pendingFullCheck = false
                Task { [weak self] in await self?.synchronize(fullCheck: full) }
            }
        }
        let configurationRevision = folderSync.configurationRevision
        do {
            if fullCheck { _ = try await perform { $0.invalidate(); return try $0.load() }; syncRevision = snapshot.revision }
            _ = try await folderSync.synchronizeInBackground(store, fullCheck: fullCheck, onImport: { [weak self] in self?.publishImported($0) })
            publish(try await EventWorkers.run { try store.snapshot() })
            guard folderSync.configurationRevision == configurationRevision else { return }
            syncStatus = "文件已合并并写入同步目录；iCloud 传输由系统处理"
        } catch is CancellationError {
            return
        } catch {
            // Import may have completed before a later upload/download failed.
            if let next = try? await EventWorkers.run(on: EventWorkers.local, { try store.snapshot() }), next.revision > snapshot.revision { publishImported(next) }
            guard folderSync.configurationRevision == configurationRevision else { return }
            syncStatus = "同步未完成：\(error.localizedDescription)"
        }
    }
}
