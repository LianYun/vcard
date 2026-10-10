import Foundation

@main struct StudyStartTests {
    @MainActor static func call(_ bridge: CloudBridge, _ command: String, _ args: [String: Any] = [:]) async throws -> (Any, Double, Int) {
        let start = Date()
        let reply = try await bridge.execute(JSONSerialization.data(withJSONObject: ["command": command, "args": args]))
        // Include the actual outer JSON wire encoding, just as vibe_cloud_request does.
        let wire = try JSONSerialization.data(withJSONObject: ["value": reply])
        return (reply, Date().timeIntervalSince(start) * 1000, wire.count)
    }
    static func ids(_ reply: Any) -> Set<String> {
        Set(((reply as! [String: Any])["cards"] as! [[String: Any]]).map { $0["id"] as! String })
    }
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("vibe-start-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let day = Day.key(), args: [String: Any] = ["scope": NSNull(), "deckId": NSNull(), "ahead": 0]
        let bridge = CloudBridge(directory: root.appendingPathComponent("functional"))
        _ = try await call(bridge, "saveCards", ["cards": [
            ["id": "a", "front": "a", "back": "A", "tags": ["work"], "noteId": "pair", "deckId": "child"],
            ["id": "b", "front": "b", "back": "B", "tags": ["work"], "noteId": "pair", "deckId": "child"],
            ["id": "c", "front": "c", "back": "C", "tags": ["other"]],
            ["id": "d", "front": "d", "back": "D", "tags": ["work"], "deckId": "child"]]])
        _ = try await call(bridge, "saveDeck", ["deck": ["id": "parent", "name": "Parent", "newCardsPerDay": 1]])
        _ = try await call(bridge, "saveDeck", ["deck": ["id": "child", "name": "Child", "parentId": "parent"]])
        _ = try await call(bridge, "control", ["id": "d", "control": ["suspended": true]])
        var scoped = args; scoped["scope"] = ["work"]; scoped["deckId"] = "parent"
        let first = try await call(bridge, "startStudy", scoped)
        let chosen = ids(first.0)
        precondition(chosen.count == 1 && chosen.isSubset(of: ["a", "b"]))
        let data = (first.0 as! [String: Any])["data"] as! [String: Any]
        precondition(Set((data["progress"] as! [String: Any]).keys) == chosen)
        precondition((data["reviews"] as! [Any]).isEmpty)
        let meta = try await call(bridge, "meta").0 as! [String: Any]
        precondition(meta["newCardsIssued"] as! Int == 1)
        let repeated = try await call(bridge, "startStudy", scoped).0
        precondition(ids(repeated) == chosen)
        // Issuance remains durable after reopening; no second issue on repeated starts.
        let reopened = CloudBridge(directory: root.appendingPathComponent("functional"))
        let restored = try await call(reopened, "startStudy", scoped).0
        precondition(ids(restored) == chosen)
        var emptyScope = args; emptyScope["scope"] = [String]()
        let empty = try await call(bridge, "startStudy", emptyScope).0 as! [String: Any]
        precondition(ids(empty).isEmpty && empty["emptyReason"] as! String == "没有匹配卡片，请选择其他标签")
        // A reviewed future card is eligible for ahead, without consuming the new-card quota.
        try await bridge.persistence.perform { store in
            var state = SchedulingState(cardId: "c", due: Day.adding(3, to: day))
            state.lastReviewedAt = Date().timeIntervalSince1970 * 1000; state.phase = "review"; state.repetitions = 2
            var event = SyncEvent(kind: .review, progress: state); event.before = SchedulingState(cardId: "c"); event.quality = 4
            try store.append([event])
        }
        var ahead = args; ahead["ahead"] = 3
        let aheadReply = try await call(bridge, "startStudy", ahead).0
        let aheadMeta = try await call(bridge, "meta").0 as! [String: Any]
        precondition(ids(aheadReply) == ["c"])
        precondition(aheadMeta["newCardsIssued"] as! Int == 1)
        // The new reply must preserve FSRS migration/config, so preview and durable grading agree.
        let aheadData = (aheadReply as! [String: Any])["data"] as! [String: Any]
        let queueState = (aheadData["progress"] as! [String: Any])["c"]!
        let conventional = try await call(bridge, "studyData", ["ids": ["c"], "includeReviews": false]).0 as! [String: Any]
        let before = try JSONSerialization.data(withJSONObject: queueState, options: [.sortedKeys])
        let expected = try JSONSerialization.data(withJSONObject: (conventional["progress"] as! [String: Any])["c"]!, options: [.sortedKeys])
        precondition(before == expected)
        let config = aheadData["schedulerConfig"] as! [String: Any]
        let gradeReply = try await call(bridge, "review", ["id": "c", "quality": 4,
            "context": ["now": Date().timeIntervalSince1970 * 1000, "configId": config["id"]!, "before": queueState]]).0 as! [String: Any]
        precondition((gradeReply["record"] as! [String: Any])["algorithm"] as! String == FSRSScheduler.algorithm)
        ahead["ahead"] = 6
        do { _ = try await call(bridge, "startStudy", ahead); preconditionFailure("invalid ahead accepted") } catch {}
        print("PASS: native atomic start, tags, parent deck quota, sibling dedup, suspended cards, empty scope, repeated start/reopen, ahead isolation and validation")

        // Same shape as the frontend performance fixture: 2k rich cards, 50k reviews, 120 due.
        let perfRoot = root.appendingPathComponent("performance")
        let eventsURL = perfRoot.appendingPathComponent("library/events")
        try FileManager.default.createDirectory(at: eventsURL, withIntermediateDirectories: true)
        try await EventWorkers.run {
            var events: [SyncEvent] = []
            let cards = (0..<2000).map { Card(id: "perf:\($0)", front: "word-\($0)", back: String(repeating: "Long synthetic definition and example. ", count: 40)) }
            for (i, card) in cards.enumerated() {
                var event = SyncEvent(kind: .add, card: card); event.timestamp = Double(i + 1); events.append(event)
            }
            for i in 0..<50000 {
                let index = i % cards.count, id = cards[index].id
                var state = SchedulingState(cardId: id, due: index < 120 ? day : Day.adding(1, to: day))
                state.phase = "review"; state.repetitions = 2; state.interval = 6; state.lastReviewedAt = 1
                var event = SyncEvent(kind: .review, progress: state)
                event.id = "history:\(i)"; event.timestamp = Double(3000 + i); event.quality = 4; event.before = state
                events.append(event)
            }
            for offset in stride(from: 0, to: events.count, by: 200) {
                let wire = try OpenFormat.encode(EventFile(events: Array(events[offset..<min(offset + 200, events.count)])))
                try wire.write(to: eventsURL.appendingPathComponent(OpenFormat.digest(wire) + ".json"))
            }
        }
        let perf = CloudBridge(directory: perfRoot)
        let coldStart = Date(); _ = try await call(perf, "status")
        print("cold_open_ms=\(Date().timeIntervalSince(coldStart) * 1000)")
        for iteration in 0..<5 {
            var legacyMs = 0.0, legacyBytes = 0, stages: [String: Double] = [:]
            for command in ["cards", "studyData", "settings", "meta", "decks", "issue", "studyData"] {
                let label = command == "studyData" ? (stages["studyDataAll"] == nil ? "studyDataAll" : "studyDataQueue") : command
                let input: [String: Any] = command == "issue" ? ["ids": [String]()] : command == "studyData" ?
                    (label == "studyDataAll" ? ["includeReviews": false] : ["includeReviews": false, "ids": (0..<120).map { "perf:\($0)" }]) : [:]
                let result = try await call(perf, command, input)
                stages[label] = result.1; legacyMs += result.1; legacyBytes += result.2
            }
            let result = try await call(perf, "startStudy", args)
            precondition(ids(result.0) == Set((0..<120).map { "perf:\($0)" }))
            let row: [String: Any] = ["iteration": iteration, "legacyRpcMs": legacyMs, "legacyBytes": legacyBytes,
                                    "legacyStages": stages, "newRpcMs": result.1, "newBytes": result.2,
                                    "newStages": (result.0 as! [String: Any])["timings"]!]
            print(String(decoding: try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]), as: UTF8.self))
        }
        _ = try await EventWorkers.run(on: EventWorkers.sync) { () }
    }
}
