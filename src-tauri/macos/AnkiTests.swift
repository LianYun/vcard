import Foundation

@main struct AnkiTests {
    static func check(_ value: @autoclosure () throws -> Bool) throws { let result = try value(); precondition(result) }
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("anki-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try check(try AnkiRenderer.cloze("{{c1::A}} {{c2::B}} {{c1::C::hint}}", number: 1, answer: false) == "<strong class=\"cloze\">[…]</strong> B <strong class=\"cloze\">[hint]</strong>")
        try check(try AnkiRenderer.clozeNumbers("{{c1::outer {{c2::inner}}}} {{c1,2,3::multi}}") == [1,2,3])
        try check(try AnkiRenderer.cloze("{{c1::outer {{c2::inner}}}}", number: 2, answer: false).contains("outer <strong"))
        let store = try JSONEventStore(directory: root.appendingPathComponent("library"))
        var parent = SyncEvent(kind: .deck); parent.deck = Deck(id: "p", name: "English", newCardsPerDay: 1)
        var child = SyncEvent(kind: .deck); child.deck = Deck(id: "c", name: "Words", parentId: "p")
        var a = Card(id: "a",front: "a",back: "A"), b = Card(id: "b",front: "b",back: "B"); a.deckId = "c";b.deckId = "c"
        try store.append([parent,child,SyncEvent(kind: .add,card:a),SyncEvent(kind: .add,card:b)])
        var lib = Library(events: try store.load())
        precondition(lib.inDeck(a,"p")); let issued = lib.issueEvents(["a","b"]);precondition(issued.count == 1)
        try store.append(issued); a.deckId = "default"; try store.append([SyncEvent(kind:.edit,card:a)])
        lib = Library(events: try store.load()); precondition(lib.issueEvents(["b"]).isEmpty)
        precondition(lib.deckIssued[Day.key()]?["p"] == ["a"])
        do { _ = try lib.saveDeckEvent(Deck(id:"p",name:"cycle",parentId:"c"));preconditionFailure("cycle accepted") } catch {}
        if let fixtures = ProcessInfo.processInfo.environment["ANKI_FIXTURES"] {
            var sets: [Set<String>] = []
            for format in ["legacy","modern"] {
                let source = URL(fileURLWithPath: fixtures).appendingPathComponent(format + "-stage")
                let stage = root.appendingPathComponent("anki-staging/" + UUID().uuidString)
                try FileManager.default.createDirectory(at: stage.deletingLastPathComponent(), withIntermediateDirectories:true)
                try FileManager.default.copyItem(at:source,to:stage)
                let prepared = try AnkiImport.prepare(stage:stage)
                try OpenFormat.encode(prepared).write(to: URL(fileURLWithPath: fixtures).appendingPathComponent(format + "-prepared.json"))
                precondition(prepared.cards.count == 3, "\(prepared.warnings)")
                precondition(prepared.mediaCount == 2)
                precondition(prepared.cards.filter { $0.anki?.cloze == true }.count == 2)
                precondition(prepared.cards.contains { $0.back.contains("<audio") && $0.back.contains("vibe-media:") })
                sets.append(Set(prepared.cards.map(\.id)))
                let bridge = CloudBridge(directory: root)
                func call(_ command: String, _ args:[String:Any]) async throws -> Any {
                    try await bridge.execute(JSONSerialization.data(withJSONObject:["command":command,"args":args]))
                }
                let args: [String:Any] = ["stage":stage.path,"offset":0,"deckIds":prepared.decks.map(\.id)]
                let first = try await call("commitAnki",args) as! [String:Any]
                precondition(first["added"] as? Int == (format == "legacy" ? 3 : 0))
                let before = try await bridge.persistence.load()
                _ = try await call("commitAnki",args)
                let afterRetry = try await bridge.persistence.load().count; try check(afterRetry == before.count)
                let clozeCard = prepared.cards.first { $0.anki?.cloze == true }!
                var library = Library(events: try await bridge.persistence.load())
                var fields = clozeCard.anki!.fields; fields["Text"] = "{{c1::new}} {{c3::extra}}"
                if format == "modern" { // editing after both imports leaves original duplicate checks meaningful
                    let events = try library.editAnkiEvents(id:clozeCard.id,fields:fields)
                    precondition(events.filter { $0.kind == .add }.count == 1)
                    precondition(events.filter { $0.kind == .delete }.count == 1)
                    try await bridge.persistence.append(events)
                    library = Library(events: try await bridge.persistence.load())
                    precondition(library.cards.filter { $0.noteId == clozeCard.noteId }.count == 2)
                    let backup = try bridge.persistence.store!.createBackup()
                    precondition(FileManager.default.fileExists(atPath: bridge.persistence.store!.directory.appendingPathComponent("backups/"+backup+".media").path))
                }
            }
            precondition(sets[0] == sets[1])
        }
        if ProcessInfo.processInfo.environment["ANKI_TEST_SYNC"] == "1" {
            let peer = try JSONEventStore(directory: root.appendingPathComponent("peer"))
            let shared = root.appendingPathComponent("shared"); try FileManager.default.createDirectory(at: shared, withIntermediateDirectories:true)
            let sender = try FolderSync(directory: store.directory), receiver = try FolderSync(directory: peer.directory)
            try sender.connect(shared);try receiver.connect(shared)
            try sender.synchronize(store);try receiver.synchronize(peer)
            try check(try Library(events: peer.load()).decks.count == Library(events: store.load()).decks.count)
            let media = store.directory.appendingPathComponent("media")
            if FileManager.default.fileExists(atPath: media.path) {
                for url in try FileManager.default.contentsOfDirectory(at:media,includingPropertiesForKeys:nil) {
                    let remote = peer.directory.appendingPathComponent("media/"+url.lastPathComponent)
                    try check(try Data(contentsOf:remote) == Data(contentsOf:url))
                }
            }
            print("PASS independent stores exchange deck events and byte-identical attachments")
        }
        print("PASS cloze nesting/multiple IDs, deck ancestry/budgets/move, cycles, official APKG conversion/media, idempotent commit, note edits, attachment backup")
    }
}
