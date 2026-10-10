import Foundation
import SQLite3
import CoreData

@main struct BridgeTests {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("vibe-cloud-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var db: OpaquePointer?
        precondition(sqlite3_open(root.appendingPathComponent("vword.db").path, &db) == SQLITE_OK)
        let sql = """
        CREATE TABLE cards(id TEXT,front TEXT,back TEXT,example TEXT,created_at INTEGER);
        CREATE TABLE progress(card_id TEXT,ease REAL,interval INTEGER,repetitions INTEGER,due TEXT,last_reviewed_at INTEGER);
        CREATE TABLE daily_stats(date TEXT,reviewed INTEGER,added INTEGER);
        CREATE TABLE settings(key TEXT,value TEXT);
        INSERT INTO cards VALUES('legacy','old','旧词',NULL,12345);
        INSERT INTO progress VALUES('legacy',2.6,6,2,'2026-10-01',123456789);
        INSERT INTO daily_stats VALUES('2026-10-01',42,17);
        INSERT INTO settings VALUES('new_cards_per_day','23');
        INSERT INTO settings VALUES('llm_base_url','https://example.invalid');
        INSERT INTO settings VALUES('llm_api_key','fixture-only');
        INSERT INTO settings VALUES('llm_model','test');
        """
        precondition(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(db)
        let bridge = CloudBridge(directory: root)
        func call(_ command: String, _ args: [String: Any] = [:]) async throws -> Any {
            try await bridge.execute(JSONSerialization.data(withJSONObject: ["command": command, "args": args]))
        }
        _ = try await call("status")
        var library = Library(events: try await bridge.persistence.load())
        precondition(library.cards.count == 1 && library.cards[0].createdAt == 12345)
        precondition(library.progress["legacy"]?.lastReviewedAt == 123456789)
        precondition(library.stats["2026-10-01"]?.reviewed == 42 && library.stats["2026-10-01"]?.added == 17)
        precondition(library.newCardsPerDay == 23 && library.llm.apiKey == "fixture-only")
        let firstCount = try await bridge.persistence.load().count
        _ = try await call("status")
        let nextCount = try await bridge.persistence.load().count
        precondition(nextCount == firstCount)
        // Crash/re-import: stable IDs keep aggregate statistics and progress identical.
        let source = try String(contentsOf: root.appendingPathComponent("migration-source"), encoding: .utf8)
        try await bridge.persistence.append(LegacyImport.events(at: root.appendingPathComponent("vword.db").path, source: source))
        library = Library(events: try await bridge.persistence.load())
        precondition(library.stats["2026-10-01"]?.reviewed == 42)
        _ = try await call("saveCards", ["cards": [["id": "new", "front": "word", "back": "含义", "createdAt": 12346]]])
        _ = try await call("review", ["id": "new", "quality": 4])
        _ = try await call("review", ["id": "new", "quality": 4])
        library = Library(events: try await bridge.persistence.load())
        precondition(library.progress["new"]?.fsrs?.version == 6 && library.progress["new"]!.interval > 1 && library.progress["new"]?.learningDue == nil)
        precondition(library.stats[Day.key()]?.reviewed == 2 && library.stats[Day.key()]?.added == 1)
        let progressBeforeTags = library.progress
        let statsBeforeTags = library.stats
        _ = try await call("updateCard", ["id": "new", "front": "word", "back": "含义", "tags": ["work", "travel"]])
        library = Library(events: try await bridge.persistence.load())
        precondition(library.cards.first { $0.id == "new" }?.tags == ["work", "travel"])
        precondition(library.progress == progressBeforeTags && library.stats == statsBeforeTags)
        _ = try await call("updateCard", ["id": "new", "front": "word", "back": "含义", "tags": [String]()])
        library = Library(events: try await bridge.persistence.load())
        precondition(library.cards.first { $0.id == "new" }?.tags == [])
        let regenerationArgs: [String: Any] = ["expected": ["id": "new", "front": "word", "back": "含义"],
            "draft": ["front": "word", "back": "新含义", "example": "New example"]]
        _ = try await call("replaceRegeneratedCard", regenerationArgs)
        library = Library(events: try await bridge.persistence.load())
        precondition(library.cards.first { $0.id == "new" }?.back == "新含义")
        precondition(library.progress == progressBeforeTags && library.stats == statsBeforeTags)
        var staleRegenerationRejected = false
        do { _ = try await call("replaceRegeneratedCard", regenerationArgs) } catch { staleRegenerationRejected = true }
        precondition(staleRegenerationRejected)
        // Remote iOS events are decoded and projected by the exact same implementation.
        let remote = Card(id: "phone", front: "from iPhone", back: "同步")
        let events = [SyncEvent(kind: .add, card: remote), SyncEvent(kind: .delete, cardId: "new")]
        try await bridge.persistence.append(events + events)
        let cards = try await call("cards") as! [[String: Any]]
        precondition(cards.count == 2 && cards.contains { $0["id"] as? String == "phone" })
        var rejected = false
        do { _ = try await call("review", ["id": "new", "quality": 4]) } catch { rejected = true }
        precondition(rejected)
        rejected = false
        do { _ = try await call("saveCards", ["cards": [["id": "new", "front": "stale", "back": ""]]]) } catch { rejected = true }
        precondition(rejected)
        _ = try await call("issue", ["ids": ["phone", "phone", "missing"]])
        library = Library(events: try await bridge.persistence.load())
        precondition(library.issued[Day.key()] == Set(["phone"]))
        _ = try await call("issue", ["ids": ["phone"]])
        library = Library(events: try await bridge.persistence.load())
        precondition(library.issued[Day.key()]?.count == 1)
        // Recheck budget at the native transaction boundary, not the stale UI snapshot.
        try await bridge.persistence.append([SyncEvent(kind: .edit, card: Card(id: "over-budget", front: "new", back: ""))])
        _ = try await call("saveSettings", ["limit": 1])
        let refused = try await call("issue", ["ids": ["over-budget"]]) as! [String]
        precondition(refused.isEmpty)
        // Whole configuration saved in one event, including disabling image generation.
        _ = try await call("saveImage", ["config": ["baseURL": "", "apiKey": "", "model": ""]])
        library = Library(events: try await bridge.persistence.load())
        precondition(!library.image.isConfigured)
        let savedCount = try await bridge.persistence.load().count
        let reopened = CloudBridge(directory: root)
        try await reopened.prepare()
        let reopenedEvents = try await reopened.persistence.load()
        precondition(reopenedEvents.count == savedCount)
        precondition(Library(events: reopenedEvents).cards.count == 3)
        // One settings commit includes all model fields and study preferences.
        _ = try await call("savePreferences", ["limit": 37, "enabled": false,
            "llm": ["baseURL": " https://example.invalid/v1 ", "apiKey": "fixture", "model": "draft", "supportsImages": true],
            "image": ["baseURL": "", "apiKey": "", "model": ""]])
        let preferences = Library(events: try await bridge.persistence.load())
        precondition(preferences.newCardsPerDay == 37 && preferences.llm.model == "draft")
        precondition(preferences.llm.baseURL == "https://example.invalid/v1" && preferences.llm.supportsImages == true)
        _ = try await call("saveSettings", ["limit": 37, "studyScope": ["work", "", "work"]])
        let scoped = CloudBridge(directory: root)
        let scopedSettings = try await scoped.execute(JSONSerialization.data(withJSONObject: ["command": "settings"])) as! [String: Any]
        precondition(scopedSettings["studyScope"] as? [String] == ["", "work"])
        _ = try await call("saveSettings", ["limit": 36])
        let preservedScope = Library(events: try await bridge.persistence.load()).studyScope.tags
        precondition(preservedScope == ["", "work"])
        _ = try await call("saveSettings", ["limit": 37, "studyScope": NSNull()])
        let allScope = Library(events: try await bridge.persistence.load()).studyScope.tags
        precondition(allScope == nil)
        let beforeInvalid = try await bridge.persistence.load().count
        do {
            _ = try await call("savePreferences", ["limit": 101, "enabled": false,
                "llm": ["baseURL": "", "apiKey": "", "model": ""],
                "image": ["baseURL": "", "apiKey": "", "model": ""]])
            preconditionFailure("Invalid preferences accepted")
        } catch {}
        let afterInvalid = try await bridge.persistence.load().count
        precondition(beforeInvalid == afterInvalid)
        // Real NSFileCoordinator + persisted bookmark exchange on a temporary folder.
        let shared = root.appendingPathComponent("shared")
        try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
        let peer = try JSONEventStore(directory: root.appendingPathComponent("peer"))
        let localSync = try FolderSync(directory: bridge.persistence.store!.directory)
        let peerSync = try FolderSync(directory: peer.directory)
        try localSync.connect(shared); try peerSync.connect(shared)
        try localSync.synchronize(bridge.persistence.store!)
        try peerSync.synchronize(peer)
        var peerLibrary = Library(events: try peer.load())
        precondition(peerLibrary.cards.count == 3 && peerLibrary.llm.apiKey == "fixture")
        // Existing local credentials are uploaded without needing to save them again.
        var config = APIConfig()
        config.baseURL = "https://peer.example.invalid/v1"
        config.apiKey = "peer-fixture-only"
        config.model = "peer-model"
        var llmEvent = SyncEvent(kind: .llmConfig, config: config)
        llmEvent.timestamp = Date().timeIntervalSince1970 + 10
        var imageEvent = SyncEvent(kind: .imageConfig, config: config)
        imageEvent.timestamp = llmEvent.timestamp
        try peer.append([llmEvent, imageEvent])
        var phoneCard = peerLibrary.cards.first { $0.id == "phone" }!
        phoneCard.back = "edited offline on peer"
        try peer.append([SyncEvent(kind: .edit, card: phoneCard), SyncEvent(kind: .delete, cardId: "legacy")])
        try peerSync.synchronize(peer)
        try localSync.synchronize(bridge.persistence.store!)
        let merged = Library(events: try await bridge.persistence.load())
        precondition(merged.cards.first { $0.id == "phone" }?.back == "edited offline on peer")
        precondition(!merged.cards.contains { $0.id == "legacy" })
        precondition(merged.llm == config && merged.image == config)
        // Clearing a model configuration must propagate as well.
        var clear = SyncEvent(kind: .imageConfig, config: APIConfig())
        clear.timestamp = imageEvent.timestamp + 1
        try await bridge.persistence.append([clear])
        try localSync.synchronize(bridge.persistence.store!)
        try peerSync.synchronize(peer)
        let clearedLibrary = Library(events: try peer.load())
        precondition(clearedLibrary.image == APIConfig())
        let countBefore = try peer.load().count
        let resumedSync = try FolderSync(directory: peer.directory)
        precondition(resumedSync.isConnected)
        try resumedSync.synchronize(peer)
        peerLibrary = Library(events: try peer.load())
        precondition(peerLibrary.cards.count == 2)
        let countAfter = try peer.load().count
        precondition(countBefore == countAfter)
        try resumedSync.disconnect()
        precondition(!resumedSync.isConnected && FileManager.default.fileExists(atPath: shared.path))
        // Migrate an actual former Core Data store without writing a new database.
        let oldURL = root.appendingPathComponent("former.sqlite")
        let model = NSManagedObjectModel()
        let entity = NSEntityDescription(); entity.name = "SyncEvent"; entity.managedObjectClassName = "NSManagedObject"
        let payload = NSAttributeDescription(); payload.name = "payload"; payload.attributeType = .binaryDataAttributeType
        payload.isOptional = true; payload.allowsExternalBinaryDataStorage = true; payload.allowsCloudEncryption = true
        entity.properties = [payload]; model.entities = [entity]
        let coordinator = NSPersistentStoreCoordinator(managedObjectModel: model)
        let oldStore = try coordinator.addPersistentStore(type: .sqlite, at: oldURL)
        let context = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        context.persistentStoreCoordinator = coordinator
        let oldEvent = SyncEvent(kind: .add, card: Card(id: "former-phone", front: "legacy iOS", back: "保留"))
        let object = NSEntityDescription.insertNewObject(forEntityName: "SyncEvent", into: context)
        object.setValue(try JSONEncoder().encode(oldEvent), forKey: "payload")
        try context.save(); try coordinator.remove(oldStore)
        let migrated = Persistence(directory: root.appendingPathComponent("migrated-json"), legacyURL: oldURL)
        try await migrated.open()
        precondition(migrated.ready)
        let migratedLibrary = Library(events: try await migrated.load())
        precondition(migratedLibrary.cards.first?.id == "former-phone")
        let files = try FileManager.default.contentsOfDirectory(at: migrated.store!.directory, includingPropertiesForKeys: nil)
        precondition(!files.contains { $0.pathExtension == "sqlite" || $0.pathExtension == "db" })
        precondition(FileManager.default.fileExists(atPath: oldURL.path))
        // Import acceptance is atomic, idempotent, and cannot resurrect a deleted card.
        let importCards: [[String: Any]] = [
            ["id": "custom:import:test:forward", "front": "resilience", "back": "韧性", "createdAt": 12347],
            ["id": "custom:import:test:reverse", "front": "韧性", "back": "resilience", "createdAt": 12347]
        ]
        let beforeImport = try await bridge.persistence.load().count
        _ = try await call("acceptImportCards", ["cards": importCards])
        let afterImport = try await bridge.persistence.load().count
        precondition(afterImport == beforeImport + 4)
        _ = try await call("acceptImportCards", ["cards": importCards])
        let afterRetry = try await bridge.persistence.load().count
        precondition(afterRetry == afterImport)
        _ = try await call("deleteCard", ["id": "custom:import:test:forward"])
        _ = try await call("acceptImportCards", ["cards": importCards])
        let importedLibrary = Library(events: try await bridge.persistence.load())
        precondition(!importedLibrary.cards.contains { $0.id == "custom:import:test:forward" })
        precondition(importedLibrary.progress["custom:import:test:reverse"] != nil)
        let priorEvents = try await bridge.persistence.load().count
        _ = try await call("saveImportJobs", ["jobs": [["version": 1, "id": "draft-test", "prompt": "private document content"]]])
        let storedJobs = try await call("importJobs") as! [[String: Any]]
        precondition(storedJobs[0]["id"] as? String == "draft-test")
        let afterDraft = try await bridge.persistence.load().count
        precondition(priorEvents == afterDraft, "Drafts must not enter sync events")
        let taskState: [String: Any] = ["version": 1, "tasks": [["id": "ai-test", "drafts": [], "status": "paused"]]]
        _ = try await call("saveAITasks", ["state": taskState])
        let persistedTasks = try await call("aiTasks") as! [String: Any]
        precondition((persistedTasks["tasks"] as! [[String: Any]])[0]["id"] as? String == "ai-test")
        let afterTaskSave = try await bridge.persistence.load().count
        precondition(afterTaskSave == afterDraft, "AI queue must stay outside synchronized events")
        let aiCard: [String: Any] = ["id": "custom:ai:bridge", "front": "AI question", "back": "AI answer", "noteId": "ai-pair", "tags": ["reviewed"]]
        _ = try await call("confirmAIDraft", ["draftId": "bridge-draft", "card": aiCard])
        let once = try await bridge.persistence.load().count
        _ = try await call("confirmAIDraft", ["draftId": "bridge-draft", "card": aiCard])
        let twice = try await bridge.persistence.load().count
        precondition(once == twice, "Retrying confirmation must not duplicate events")
        _ = try await call("deleteCard", ["id": "custom:ai:bridge"])
        _ = try await call("confirmAIDraft", ["draftId": "bridge-draft", "card": aiCard])
        let aiLibrary = Library(events: try await bridge.persistence.load())
        precondition(!aiLibrary.cards.contains { $0.id == "custom:ai:bridge" }, "Confirmation receipts must not resurrect deleted cards")
        print("PASS: local AI task transport, formal confirmation receipt and deletion protection")
        // Fixed iCloud mode ignores even an expired legacy bookmark, persists the toggle,
        // rejects arbitrary directories, and preserves local/remote files on disable.
        let fixedLocal = root.appendingPathComponent("fixed-local")
        let fixedRoot = root.appendingPathComponent("fixed-cloud")
        try FileManager.default.createDirectory(at: fixedLocal, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: fixedRoot, withIntermediateDirectories: true)
        try Data("expired bookmark".utf8).write(to: fixedLocal.appendingPathComponent("sync-folder.bookmark"))
        let fixed = try FolderSync(directory: fixedLocal, fixedCloudRoot: fixedRoot)
        precondition(fixed.folder == fixedRoot)
        try fixed.setICloudEnabled(true)
        do { try fixed.connect(shared); preconditionFailure("Custom folder accepted") } catch {}
        let fixedStore = try JSONEventStore(directory: fixedLocal)
        try fixedStore.append([SyncEvent(kind: .add, card: Card(id: "fixed-test", front: "test", back: "test"))])
        try fixed.synchronize(fixedStore)
        // Hold file coordination open like a slow file provider. The main actor
        // must remain responsive while the sync worker waits for that provider.
        let providerStarted = DispatchSemaphore(value: 0), releaseProvider = DispatchSemaphore(value: 0)
        let providerFinished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            var error: NSError?
            NSFileCoordinator().coordinate(writingItemAt: fixedRoot.appendingPathComponent("VibeWordSync-v1"), options: .forMerging, error: &error) { _ in
                providerStarted.signal()
                _ = releaseProvider.wait(timeout: .now() + 3)
            }
            providerFinished.signal()
        }
        precondition(providerStarted.wait(timeout: .now() + 3) == .success)
        let started = Date()
        let background = Task { @MainActor in try await fixed.synchronizeInBackground(fixedStore) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let responsive = Date().timeIntervalSince(started) < 1
        let concurrent = SyncEvent(kind: .add, card: Card(id: "during-sync", front: "local", back: ""))
        let localWriteStarted = Date()
        _ = try await EventWorkers.run { try fixedStore.append([concurrent]) }
        precondition(Date().timeIntervalSince(localWriteStarted) < 1, "Local write waited for the cloud provider")
        try fixed.setICloudEnabled(false)
        releaseProvider.signal()
        do { _ = try await background.value } catch is CancellationError { }
        precondition(providerFinished.wait(timeout: .now() + 3) == .success)
        precondition(responsive, "File provider stalled the main actor")
        precondition(!fixed.isConnected, "An old sync must not restore a disabled connection")
        try fixed.setICloudEnabled(true)
        _ = try await fixed.synchronizeInBackground(fixedStore)
        let backgroundChanged = try await fixed.synchronizeInBackground(fixedStore)
        precondition(!backgroundChanged)
        let backgroundLibrary = Library(events: try fixedStore.load())
        precondition(backgroundLibrary.cards.contains { $0.id == "during-sync" })
        print("PASS: slow file provider leaves main actor responsive, concurrent write retention, disable during sync, unchanged repeat")
        // Permission denial offers recovery without mutating local events.
        precondition(FolderSync.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)))
        precondition(FolderSync.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)))
        precondition(FolderSync.isPermissionError(NSError(domain: "wrapper", code: 1,
            userInfo: [NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: Int(EACCES))])))
        precondition(!FolderSync.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: NSFileNoSuchFileError)))
        let fixedFolder = fixedRoot.appendingPathComponent("VibeWordSync-v1", isDirectory: true)
        let deniedEvents = fixedFolder.appendingPathComponent("events")
        let beforeDeniedSync = try fixedStore.load()
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: deniedEvents.path)
        do {
            defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: deniedEvents.path) }
            do { try fixed.synchronize(fixedStore); preconditionFailure("Unreadable events accepted") }
            catch { precondition(error.localizedDescription.contains("重新授权")) }
            precondition(fixed.needsAuthorization)
        }
        let afterDeniedSync = try fixedStore.load()
        let beforeDeniedData = try OpenFormat.encode(beforeDeniedSync)
        let afterDeniedData = try OpenFormat.encode(afterDeniedSync)
        precondition(beforeDeniedData == afterDeniedData)
        do { try fixed.authorizeICloudFolder(shared); preconditionFailure("Wrong authorization folder accepted") } catch {}
        try fixed.authorizeICloudFolder(fixedFolder)
        precondition(!fixed.needsAuthorization)
        try fixed.synchronize(fixedStore)
        let enabledAgain = try FolderSync(directory: fixedLocal, fixedCloudRoot: fixedRoot)
        precondition(!enabledAgain.needsAuthorization)
        try enabledAgain.synchronize(fixedStore)
        print("PASS: permission classification, unreadable events recovery, local data retention, fixed-folder reauthorization and bookmark reopen")
        precondition(enabledAgain.isConnected)
        try fixed.setICloudEnabled(false)
        let disabledAgain = try FolderSync(directory: fixedLocal, fixedCloudRoot: fixedRoot)
        precondition(!disabledAgain.isConnected)
        precondition(FileManager.default.fileExists(atPath: fixedRoot.appendingPathComponent("VibeWordSync-v1/events").path))
        let localEvents = try fixedStore.load()
        precondition(!localEvents.isEmpty)
        let missingCloud = try FolderSync(directory: fixedLocal, fixedCloudRoot: root.appendingPathComponent("unavailable-cloud"))
        do { try missingCloud.setICloudEnabled(true); preconditionFailure("Unavailable iCloud accepted") } catch {}
        precondition(!missingCloud.isConnected)
        precondition(FolderSync.isFixedICloudFolder(URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/VibeWordSync-v1")))
        precondition(!FolderSync.isFixedICloudFolder(URL(fileURLWithPath: "/private/var/mobile/Documents/VibeWordSync-v1")))
        precondition(!FolderSync.isFixedICloudFolder(URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Other/VibeWordSync-v1")))
        print("PASS: unified preferences, validation, fixed iCloud root, legacy bookmark isolation, enable/disable/reopen, retained data, unavailable iCloud and iOS folder validation")
        // Grading replies contain only one durable result and changed sibling controls.
        let deltaBridge = CloudBridge(directory: root.appendingPathComponent("delta-tests"))
        func deltaCall(_ command: String, _ args: [String: Any] = [:]) async throws -> Any {
            try await deltaBridge.execute(JSONSerialization.data(withJSONObject: ["command": command, "args": args]))
        }
        _ = try await deltaCall("saveCards", ["cards": [
            ["id": "delta-a", "front": "a", "back": "A", "noteId": "pair"],
            ["id": "delta-b", "front": "b", "back": "B", "noteId": "pair"]]])
        let beforeRating = try await deltaCall("status") as! [String: Any]
        let delta = try await deltaCall("review", ["id": "delta-a", "quality": 1]) as! [String: Any]
        let changes = delta["controlUpdates"] as! [String: Any]
        precondition(changes.count == 1 && changes["delta-b"] != nil)
        precondition((delta["record"] as? [String: Any])?["id"] as? String == delta["reviewId"] as? String)
        let afterRating = try await deltaCall("status") as! [String: Any]
        precondition(afterRating["syncRevision"] as? Int == beforeRating["syncRevision"] as? Int)
        precondition((afterRating["revision"] as! Int) > (beforeRating["revision"] as! Int))
        let session = try await deltaCall("studyData", ["ids": ["delta-a"], "includeReviews": false]) as! [String: Any]
        precondition((session["reviews"] as! [Any]).isEmpty)
        precondition(Set((session["progress"] as! [String: Any]).keys) == ["delta-a"])
        let history = try await deltaCall("reviewHistory", ["id": "delta-a"]) as! [[String: Any]]
        precondition(history.count == 1 && history[0]["id"] as? String == delta["reviewId"] as? String)
        print("PASS: small review replies, sibling controls, scoped session data, on-demand history, local rating does not trigger sync revision")
        let previewState = (session["progress"] as! [String: Any])["delta-a"] as! [String: Any]
        let schedulerConfig = session["schedulerConfig"] as! [String: Any]
        let previewTime = Date().timeIntervalSince1970 * 1000
        let fsrsContext: [String: Any] = ["now": previewTime, "configId": schedulerConfig["id"]!, "before": previewState]
        let decodedState = try JSONDecoder().decode(SchedulingState.self, from: JSONSerialization.data(withJSONObject: previewState))
        let expected = FSRSScheduler.preview(decodedState, now: previewTime)[.good]!
        let committed = try await deltaCall("review", ["id": "delta-a", "quality": 4, "context": fsrsContext]) as! [String: Any]
        precondition(committed["learningDue"] as? Double == expected.learningDue)
        precondition(committed["interval"] as? Int == expected.interval)
        do { _ = try await deltaCall("review", ["id": "delta-a", "quality": 4, "context": fsrsContext]); preconditionFailure("Stale preview accepted") } catch {}
        var updatedConfig = schedulerConfig; updatedConfig["id"] = "bridge-personal"; updatedConfig["retention"] = 0.93
        _ = try await deltaCall("saveSchedulerConfig", ["config": updatedConfig, "expectedId": schedulerConfig["id"]!])
        let savedScheduler = try await deltaCall("schedulerConfig") as! [String: Any]
        precondition(savedScheduler["id"] as? String == "bridge-personal")
        do { _ = try await deltaCall("saveSchedulerConfig", ["config": updatedConfig, "expectedId": "stale"]); preconditionFailure("Stale config accepted") } catch {}
        print("PASS: native FSRS preview/commit equality, stale preview rejection and versioned parameter updates")
        // Unified editor transport: metadata and content commit atomically.
        let editorCards = try await deltaCall("cards") as! [[String: Any]]
        let editorExpected = editorCards.first { $0["id"] as? String == "delta-a" }!
        var editorDraft = editorExpected; editorDraft["back"] = "Editor answer"; editorDraft["tags"] = ["edited"]
        let editorBefore = try Library(events: await deltaBridge.persistence.load())
        _ = try await deltaCall("saveEditedCard", ["expected": editorExpected, "draft": editorDraft])
        let editorAfter = try Library(events: await deltaBridge.persistence.load())
        precondition(editorAfter.cards.first { $0.id == "delta-a" }?.back == "Editor answer")
        precondition(editorAfter.cards.first { $0.id == "delta-a" }?.tags == ["edited"])
        precondition(editorAfter.progress == editorBefore.progress && editorAfter.stats == editorBefore.stats)
        do { _ = try await deltaCall("saveEditedCard", ["expected": editorExpected, "draft": editorDraft]); preconditionFailure("Stale editor accepted") } catch {}
        let ankiFixture: [String: Any] = ["id": "editor-anki", "front": "Question", "back": "Answer", "noteId": "editor-note", "anki": ["guid": "g", "model": "Basic", "fields": ["Text": "Old"], "question": "{{Text}}", "answer": "{{Text}}", "css": "", "ordinal": 0, "cloze": false]]
        _ = try await deltaCall("saveCards", ["cards": [ankiFixture]])
        let previewBefore = try await deltaBridge.persistence.load().count
        let editorPreview = try await deltaCall("previewAnkiEdit", ["id": "editor-anki", "fields": ["Text": "Changed"]]) as! [String: Any]
        precondition((editorPreview["cards"] as! [[String: Any]])[0]["front"] as? String == "Changed")
        let previewAfter = try await deltaBridge.persistence.load().count
        precondition(previewBefore == previewAfter)
        _ = try await deltaCall("saveEditedCard", ["expected": ankiFixture, "draft": ankiFixture, "fields": ["Text": "Changed"]])
        let ankiAfter = try Library(events: await deltaBridge.persistence.load())
        precondition(ankiAfter.cards.first { $0.id == "editor-anki" }?.front == "Changed")
        print("PASS: unified editor native transport, atomic metadata/content, stale rejection, read-only Anki preview and field save")
        if !CommandLine.arguments.contains("--storage-only") { try DocumentImportTests.run() }
        print("PASS: legacy migration, retry dedup, atomic reviews/stats, iOS events, deletion, issuance, config, reopen, folder exchange, bidirectional model configuration sync and clearing, bookmark reopen, Core Data read-only migration")
    }
}
