import Foundation

/// Fixed iCloud Drive folder with persisted authorization and Mac permission recovery.
/// No CloudKit entitlement or app ubiquity container is required.
final class SyncCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func check() throws { lock.lock(); defer { lock.unlock() }; if cancelled { throw CancellationError() } }
}
final class FolderSync: @unchecked Sendable {
    private struct Fingerprint: Equatable { let size: Int; let modified: Date? }
    private var fingerprints: [String: Fingerprint] = [:]
    private var cancellation = SyncCancellation()
    private func configurationChanged() {
        cancellation.cancel(); cancellation = SyncCancellation(); fingerprints = [:]
        configurationRevision += 1
    }
    let bookmarkURL: URL
    private(set) var folder: URL?
    private let fixedCloudRoot: URL?
    private let requiresFixedFolder: Bool
    private var authorizedFolder: URL?
    private(set) var iCloudEnabled = false
    private var permissionDenied = false
    private(set) var configurationRevision = 0
    var needsAuthorization: Bool { permissionDenied || (requiresFixedFolder && authorizedFolder == nil) }
    private var fixedBookmarkURL: URL { bookmarkURL.deletingLastPathComponent().appendingPathComponent("icloud-folder.bookmark") }
    static func isPermissionError(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSCocoaErrorDomain && [NSFileReadNoPermissionError, NSFileWriteNoPermissionError].contains(error.code) { return true }
        if error.domain == NSPOSIXErrorDomain && [Int(EACCES), Int(EPERM)].contains(error.code) { return true }
        return (error.userInfo[NSUnderlyingErrorKey] as? NSError).map { isPermissionError($0) } ?? false
    }
    static func isFixedICloudFolder(_ url: URL) -> Bool {
        let url = url.standardizedFileURL
        return url.lastPathComponent == "VibeWordSync-v1"
            && url.deletingLastPathComponent().lastPathComponent == "com~apple~CloudDocs"
    }
    private var preferenceURL: URL { bookmarkURL.deletingLastPathComponent().appendingPathComponent("icloud-enabled.json") }
    #if os(macOS)
    static var macCloudRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
    }
    #endif
    var isConnected: Bool { folder != nil }
    init(directory: URL, fixedCloudRoot: URL? = nil, requiresFixedFolder: Bool = false) throws {
        self.fixedCloudRoot = fixedCloudRoot
        self.requiresFixedFolder = requiresFixedFolder
        bookmarkURL = directory.appendingPathComponent("sync-folder.bookmark")
        if fixedCloudRoot != nil || requiresFixedFolder {
            // Mac ignores legacy bookmarks; iOS only reuses authorization for the fixed folder.
            let enabled = FileManager.default.fileExists(atPath: preferenceURL.path)
                ? try JSONDecoder().decode(Bool.self, from: Data(contentsOf: preferenceURL))
                : FileManager.default.fileExists(atPath: bookmarkURL.path)
            iCloudEnabled = enabled
            if let fixedCloudRoot {
                folder = enabled ? fixedCloudRoot : nil
                #if os(macOS)
                if let data = try? Data(contentsOf: fixedBookmarkURL) {
                    var stale = false
                    if let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale) {
                        // Restore the grant without touching iCloud during app startup.
                        // The worker validates the directory under that grant before exchange.
                        if url.standardizedFileURL == fixedCloudRoot.appendingPathComponent("VibeWordSync-v1").standardizedFileURL {
                            authorizedFolder = url
                        } else { permissionDenied = true }
                    } else { permissionDenied = true }
                }
                #endif
                return
            }
            // iOS restores authorization only for the one supported directory.
            if let data = try? Data(contentsOf: bookmarkURL) {
                var stale = false
                if let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale),
                   Self.isFixedICloudFolder(url) {
                    try? authorizeICloudFolder(url)
                    folder = enabled ? authorizedFolder : nil
                }
            }
            return
        }
        if FileManager.default.fileExists(atPath: bookmarkURL.path) {
            var stale = false
            #if os(macOS)
            let options: URL.BookmarkResolutionOptions = [.withSecurityScope, .withoutUI]
            #else
            let options: URL.BookmarkResolutionOptions = [.withoutUI]
            #endif
            folder = try URL(resolvingBookmarkData: Data(contentsOf: bookmarkURL), options: options,
                             relativeTo: nil, bookmarkDataIsStale: &stale)
            if stale, let folder { try connect(folder) }
        }
    }
    func setICloudEnabled(_ enabled: Bool) throws {
        configurationChanged()
        if requiresFixedFolder {
            if enabled && authorizedFolder == nil { throw OpenFormat.failure("请授权固定的 iCloud 目录") }
            try JSONEncoder().encode(enabled).write(to: preferenceURL, options: .atomic)
            iCloudEnabled = enabled
            folder = enabled ? authorizedFolder : nil
            return
        }
        guard let fixedCloudRoot else { throw OpenFormat.failure("不支持固定 iCloud 目录") }
        let scope = authorizedFolder ?? fixedCloudRoot
        let granted = scope.startAccessingSecurityScopedResource()
        defer { if granted { scope.stopAccessingSecurityScopedResource() } }
        if enabled {
            guard (try? scope.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                throw OpenFormat.failure("iCloud Drive 不可用，请先在系统设置中启用")
            }
            try FileManager.default.createDirectory(at: (authorizedFolder ?? fixedCloudRoot.appendingPathComponent("VibeWordSync-v1")).appendingPathComponent("events"), withIntermediateDirectories: true)
        }
        try JSONEncoder().encode(enabled).write(to: preferenceURL, options: .atomic)
        folder = enabled ? fixedCloudRoot : nil
        iCloudEnabled = enabled
    }
    func authorizeICloudFolder(_ url: URL) throws {
        configurationChanged()
        let expected = fixedCloudRoot?.appendingPathComponent("VibeWordSync-v1").standardizedFileURL
        guard (requiresFixedFolder && Self.isFixedICloudFolder(url)) || (expected != nil && url.standardizedFileURL == expected) else {
            throw OpenFormat.failure("只能授权 iCloud Drive 根目录下的 VibeWordSync-v1 文件夹")
        }
        let granted = url.startAccessingSecurityScopedResource()
        defer { if granted { url.stopAccessingSecurityScopedResource() } }
        guard try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]).isDirectory == true,
              try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
            throw OpenFormat.failure("请选择文件夹")
        }
        // Validate the child directory while the picker grant is active.
        let events = url.appendingPathComponent("events", isDirectory: true)
        try FileManager.default.createDirectory(at: events, withIntermediateDirectories: true)
        _ = try FileManager.default.contentsOfDirectory(at: events, includingPropertiesForKeys: nil)
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = []
        #endif
        let data = try url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
        try data.write(to: fixedCloudRoot == nil ? bookmarkURL : fixedBookmarkURL, options: .atomic)
        authorizedFolder = url
        permissionDenied = false
        if requiresFixedFolder && iCloudEnabled { folder = url }
    }
    func connect(_ url: URL) throws {
        configurationChanged()
        guard fixedCloudRoot == nil && !requiresFixedFolder else { throw OpenFormat.failure("iCloud 目录不可更改") }
        let granted = url.startAccessingSecurityScopedResource()
        defer { if granted { url.stopAccessingSecurityScopedResource() } }
        guard try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
            throw OpenFormat.failure("请选择文件夹")
        }
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = []
        #endif
        let data = try url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
        try data.write(to: bookmarkURL, options: .atomic)
        folder = url
    }
    func disconnect() throws {
        configurationChanged()
        if fixedCloudRoot != nil || requiresFixedFolder { try setICloudEnabled(false); return }
        if FileManager.default.fileExists(atPath: bookmarkURL.path) { try FileManager.default.removeItem(at: bookmarkURL) }
        folder = nil
    }
    static func readFile(_ url: URL) throws -> Data {
        let granted = url.startAccessingSecurityScopedResource()
        defer { if granted { url.stopAccessingSecurityScopedResource() } }
        var error: NSError?
        var result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { actual in
            result = Result { try OpenFormat.read(actual) }
        }
        if let error { throw error }
        guard let result else { throw OpenFormat.failure("无法读取文件") }
        return try result.get()
    }
    static func writeFile(_ data: Data, to url: URL) throws {
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &error) { actual in
            result = Result { try data.write(to: actual, options: .atomic) }
        }
        if let error { throw error }
        guard let result else { throw OpenFormat.failure("无法写入文件") }
        try result.get()
    }
    // The worker owns a private configuration snapshot. UI authorization/toggle
    // changes never race with its mutable permission state or file coordination.
    private init(snapshot: FolderSync) {
        cancellation = snapshot.cancellation
        fingerprints = snapshot.fingerprints
        bookmarkURL = snapshot.bookmarkURL
        folder = snapshot.folder
        fixedCloudRoot = snapshot.fixedCloudRoot
        requiresFixedFolder = snapshot.requiresFixedFolder
        authorizedFolder = snapshot.authorizedFolder
        iCloudEnabled = snapshot.iCloudEnabled
        permissionDenied = snapshot.permissionDenied
    }
    @MainActor func configure(_ operation: @escaping (FolderSync) throws -> Void) async throws {
        configurationChanged() // Cancel an in-flight provider job before awaiting its queue.
        let revision = configurationRevision, copy = FolderSync(snapshot: self)
        copy.cancellation = SyncCancellation()
        try await EventWorkers.run(on: EventWorkers.sync) { try operation(copy) }
        guard revision == configurationRevision else { return }
        folder = copy.folder; authorizedFolder = copy.authorizedFolder
        iCloudEnabled = copy.iCloudEnabled; permissionDenied = copy.permissionDenied
        fingerprints = copy.fingerprints
    }
    private struct SyncJob: @unchecked Sendable {
        let sync: FolderSync // Exclusively owned by the detached task until it completes.
        let store: JSONEventStore
    }
    @MainActor @discardableResult func synchronizeInBackground(_ store: JSONEventStore, fullCheck: Bool = false, onImport: (@MainActor (StoreSnapshot) -> Void)? = nil) async throws -> Bool {
        let revision = configurationRevision
        let job = SyncJob(sync: FolderSync(snapshot: self), store: store)
        let result: Result<Bool, Error>
        do {
            let incoming = try await EventWorkers.run(on: EventWorkers.sync) { try job.sync.readIncoming(fullCheck: fullCheck) }
            try job.sync.cancellation.check()
            let changed = try await EventWorkers.run {
                try job.sync.cancellation.check()
                return try job.store.appendBatches(incoming.batches)
            }
            if changed { onImport?(try await EventWorkers.run { try job.store.snapshot() }) }
            let exports = try await EventWorkers.run { try job.store.exportSnapshot() }
            let mediaChanged = try await EventWorkers.run(on: EventWorkers.sync) {
                try job.sync.finishExchange(directory: job.store.directory, exports: exports, incoming: incoming, fullCheck: fullCheck)
            }
            result = .success(changed || mediaChanged)
        } catch {
            if Self.isPermissionError(error) { job.sync.permissionDenied = true }
            result = .failure(error)
        }
        if configurationRevision == revision {
            permissionDenied = job.sync.permissionDenied
            authorizedFolder = job.sync.authorizedFolder
            folder = job.sync.folder
            fingerprints = job.sync.fingerprints
        }

        return try result.get()
    }
    @discardableResult func synchronize(_ store: JSONEventStore) throws -> Bool {
        do { return try exchange(store) }
        catch {
            if Self.isPermissionError(error) {
                permissionDenied = true
                throw OpenFormat.failure("无法访问 iCloud 同步目录，请重新授权；本地数据仍可使用")
            }
            throw error
        }
    }
    private func readIncoming(fullCheck: Bool) throws -> Incoming {
        let start = Date(); defer { StoreMetrics.record("sync-read", since: start) }
        try cancellation.check()
        guard let folder else { throw CancellationError() }
        if let fixedCloudRoot, authorizedFolder == nil,
           (try? fixedCloudRoot.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) != true {
            throw OpenFormat.failure("iCloud Drive 不可用，请先在系统设置中启用")
        }
        let scope = authorizedFolder ?? folder
        let granted = scope.startAccessingSecurityScopedResource()
        defer { if granted { scope.stopAccessingSecurityScopedResource() } }
        if requiresFixedFolder && (!granted || (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) != true) {
            authorizedFolder = nil; self.folder = nil
            throw OpenFormat.failure("请授权固定的 iCloud 目录")
        }
        let root = authorizedFolder ?? (requiresFixedFolder ? folder : folder.appendingPathComponent("VibeWordSync-v1", isDirectory: true))
        if authorizedFolder != nil {
            let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { throw OpenFormat.failure("请选择文件夹") }
        }
        let eventsURL = root.appendingPathComponent("events", isDirectory: true)
        var coordinationError: NSError?
        var creationError: Error?
        NSFileCoordinator().coordinate(writingItemAt: root, options: .forMerging, error: &coordinationError) { actual in
            do { try FileManager.default.createDirectory(at: actual.appendingPathComponent("events"), withIntermediateDirectories: true) }
            catch { creationError = error }
        }
        if let error = coordinationError ?? creationError as NSError? { throw error }
        try cancellation.check()
        let remote = try FileManager.default.contentsOfDirectory(at: eventsURL,
            includingPropertiesForKeys: [.isRegularFileKey], options: [])
        var pendingDownload = false
        var incoming: [[SyncEvent]] = []
        var checked: [String: Fingerprint] = [:]
        for url in remote {
            try cancellation.check()
            // iCloud placeholders are not complete JSON. Request download and retry later.
            if url.lastPathComponent.hasPrefix(".") && url.pathExtension == "icloud" {
                let name = String(url.lastPathComponent.dropFirst().dropLast(".icloud".count))
                try FileManager.default.startDownloadingUbiquitousItem(at: url.deletingLastPathComponent().appendingPathComponent(name))
                pendingDownload = true; continue
            }
            guard url.pathExtension == "json" else { continue }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .ubiquitousItemDownloadingStatusKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { throw OpenFormat.failure("同步目录中包含无效文件") }
            if let status = values.ubiquitousItemDownloadingStatus, status == .notDownloaded {
                try FileManager.default.startDownloadingUbiquitousItem(at: url)
                pendingDownload = true; continue
            }
            let stamp = try fingerprint(url)
            if !fullCheck && fingerprints[url.lastPathComponent] == stamp { continue }
            let events = try EventFile.decode(Self.readFile(url)).events
            incoming.append(events)
            checked[url.lastPathComponent] = stamp
        }
        return Incoming(root: root, batches: incoming, pending: pendingDownload, checked: checked)
    }
    private struct Incoming {
        let root: URL; let batches: [[SyncEvent]]; let pending: Bool
        let checked: [String: Fingerprint]
    }
    private func fingerprint(_ url: URL) throws -> Fingerprint {
        let v = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        return Fingerprint(size: v.fileSize ?? -1, modified: v.contentModificationDate)
    }
    private func exchange(_ store: JSONEventStore) throws -> Bool {
        let incoming = try readIncoming(fullCheck: true)
        let changed = try store.appendBatches(incoming.batches)
        return try finishExchange(directory: store.directory, exports: store.exportSnapshot(), incoming: incoming, fullCheck: true) || changed
    }
    private func finishExchange(directory: URL, exports: [ExportFile], incoming: Incoming, fullCheck: Bool) throws -> Bool {
        let start = Date(); defer { StoreMetrics.record("sync-write", since: start, count: exports.count) }
        try cancellation.check()
        let root = incoming.root
        let scope = authorizedFolder ?? folder ?? root
        let granted = scope.startAccessingSecurityScopedResource()
        defer { if granted { scope.stopAccessingSecurityScopedResource() } }
        let eventsURL = root.appendingPathComponent("events")
        var pendingDownload = incoming.pending, changed = false
        for file in exports {
            try cancellation.check()
            let destination = eventsURL.appendingPathComponent(file.name)
            if FileManager.default.fileExists(atPath: destination.path) {
                let stamp = try fingerprint(destination)
                if !fullCheck && fingerprints[file.name] == stamp { continue }
                guard try Self.readFile(destination) == file.data else { throw OpenFormat.failure("同步文件内容冲突，请保留文件并检查") }
            } else { try Self.writeFile(file.data, to: destination) }
            fingerprints[file.name] = try fingerprint(destination)
        }
        fingerprints.merge(incoming.checked) { _, new in new }
        // Attachments are immutable and hash-addressed; never delete files during sync.
        let remoteMedia = root.appendingPathComponent("media"), localMedia = directory.appendingPathComponent("media")
        try FileManager.default.createDirectory(at: remoteMedia, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: localMedia, withIntermediateDirectories: true)
        for url in try FileManager.default.contentsOfDirectory(at: remoteMedia, includingPropertiesForKeys: nil) {
            try cancellation.check()
            if url.lastPathComponent.hasPrefix(".") && url.pathExtension == "icloud" {
                let name = String(url.lastPathComponent.dropFirst().dropLast(".icloud".count))
                if MediaStore.valid(name) { try FileManager.default.startDownloadingUbiquitousItem(at: remoteMedia.appendingPathComponent(name)); pendingDownload = true }
                continue
            }
            guard MediaStore.valid(url.lastPathComponent) else { continue }
            let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .ubiquitousItemDownloadingStatusKey])
            guard values.isSymbolicLink != true, values.isRegularFile == true else { throw OpenFormat.failure("附件文件无效") }
            if values.ubiquitousItemDownloadingStatus == .notDownloaded { try FileManager.default.startDownloadingUbiquitousItem(at: url); pendingDownload = true; continue }
            if !FileManager.default.fileExists(atPath: localMedia.appendingPathComponent(url.lastPathComponent).path) {
                try MediaStore.install(Self.readFile(url), id: url.lastPathComponent, directory: directory); changed = true
            }
        }
        for url in try FileManager.default.contentsOfDirectory(at: localMedia, includingPropertiesForKeys: nil) where MediaStore.valid(url.lastPathComponent) {
            try cancellation.check()
            let target = remoteMedia.appendingPathComponent(url.lastPathComponent)
            if !FileManager.default.fileExists(atPath: target.path) { try Self.writeFile(OpenFormat.read(url), to: target) }
        }
        if pendingDownload { throw OpenFormat.failure("部分 iCloud 文件正在下载，本地修改已导出；稍后重试") }
        permissionDenied = false
        return changed
    }
}
