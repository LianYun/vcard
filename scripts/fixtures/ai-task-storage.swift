import Foundation

@main struct AITaskStorageTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ai-task-storage-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var tasks: [[String: Any]] = (0..<85).map { index in
            ["id": "task-\(index)", "status": "review", "drafts": [["id": "draft-\(index)", "status": "ready", "card": ["back": "![image](data:image/png;base64," + String(repeating: "A", count: 470_000) + ")"]]]]
        }
        let legacy = try JSONSerialization.data(withJSONObject: ["version": 1, "migratedImports": true, "tasks": tasks])
        let legacyURL = directory.appendingPathComponent("ai-tasks.json")
        try legacy.write(to: legacyURL)
        let store = LocalAITaskStore(directory: directory)
        let loaded = try store.load()
        precondition((loaded["tasks"] as! [[String: Any]]).count == 85)
        precondition(loaded["migratedImports"] as? Bool == true)
        let retained = try Data(contentsOf: legacyURL)
        precondition(retained == legacy, "Migration must preserve the recovery copy")
        let folder = directory.appendingPathComponent("ai-tasks-v2")
        let manifestURL = folder.appendingPathComponent("manifest.json")
        let previousManifest = try Data(contentsOf: manifestURL)
        let filesBefore = Set(try FileManager.default.contentsOfDirectory(atPath: folder.path))
        tasks[0]["status"] = "done"
        let order = tasks.map { $0["id"] as! String }
        let started = Date()
        try store.save(tasks: [tasks[0]], order: order, migratedImports: true)
        let elapsed = Date().timeIntervalSince(started) * 1000
        let filesAfter = Set(try FileManager.default.contentsOfDirectory(atPath: folder.path))
        precondition(filesAfter.subtracting(filesBefore).count == 1, "Only the changed task gets a new object")
        precondition(filesBefore.subtracting(filesAfter).count == 1)
        let restarted = try LocalAITaskStore(directory: directory).load()
        precondition((restarted["tasks"] as! [[String: Any]])[0]["status"] as? String == "done")
        let goodManifest = try Data(contentsOf: manifestURL)
        precondition(previousManifest != goodManifest)
        do {
            try store.save(tasks: [], order: ["missing"], migratedImports: true)
            preconditionFailure("Missing tasks must fail")
        } catch {}
        let unchanged = try Data(contentsOf: manifestURL)
        precondition(unchanged == goodManifest, "Failed writes must keep the last committed manifest")
        // An unreadable manifest must fail closed; it must not fall back to legacy data.
        try FileManager.default.removeItem(at: manifestURL)
        try FileManager.default.createDirectory(at: manifestURL, withIntermediateDirectories: false)
        do {
            try store.save(tasks: [tasks[0]], order: order, migratedImports: true)
            preconditionFailure("Unreadable manifest must fail")
        } catch {}
        try FileManager.default.removeItem(at: manifestURL)
        try goodManifest.write(to: manifestURL)
        try store.save(tasks: [], order: [order[0]], migratedImports: true)
        let remaining = try store.load()["tasks"] as! [[String: Any]]
        precondition(remaining.count == 1)
        try store.save(tasks: [], order: [], migratedImports: true)
        let cleared = try store.load()["tasks"] as! [[String: Any]]
        precondition(cleared.isEmpty, "Clearing must not resurrect legacy tasks")
        let payload = try JSONSerialization.data(withJSONObject: ["tasks": [tasks[0]], "order": order])
        print("PASS AI task migration, incremental writes, restart, failed-save recovery and clearing")
        print("Synthetic 85-task queue: \(legacy.count) bytes; confirmation payload: \(payload.count) bytes; native save: \(Int(elapsed)) ms")
    }
}
