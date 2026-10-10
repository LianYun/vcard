import XCTest
@testable import VibeWordCore

final class JSONStoreTests: XCTestCase {
    func temporaryStore() throws -> JSONEventStore {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { EventWorkers.sync.sync {}; try? FileManager.default.removeItem(at: url) }
        return try JSONEventStore(directory: url)
    }
    func testOpenImportUpdateExportAndRestart() throws {
        let store = try temporaryStore()
        let input = Data(#"{"format":"vibe-word.cards","version":1,"cards":[{"id":"other:one","front":"apple","back":"苹果"}]}"#.utf8)
        XCTAssertEqual(try store.importCards(input), 1)
        XCTAssertEqual(try store.importCards(input), 0)
        let state = SM2.grade(SchedulingState(cardId: "other:one"), quality: .good)
        try store.append([SyncEvent(kind: .review, progress: state)])
        let updated = Data(#"{"format":"vibe-word.cards","version":1,"cards":[{"id":"other:one","front":"apple","back":"更新释义"}]}"#.utf8)
        XCTAssertEqual(try store.importCards(updated), 1)
        let reopened = try JSONEventStore(directory: store.directory)
        let library = Library(events: try reopened.load())
        XCTAssertEqual(library.cards.first?.back, "更新释义")
        XCTAssertEqual(library.progress["other:one"], state)
        XCTAssertEqual(library.stats[Day.key()]?.added, 1)
        let export = try CardFile.decode(reopened.exportCards())
        XCTAssertEqual(export.cards, library.cards)
    }
    func testInvalidImportDoesNotPartiallyWrite() throws {
        let store = try temporaryStore()
        for body in [
            #"{"format":"vibe-word.cards","version":99,"cards":[]}"#,
            #"{"format":"vibe-word.cards","version":1,"cards":[{"id":"one","front":"ok","back":""},{"id":"two","front":"","back":""}]}"#,
            #"{"format":"vibe-word.cards","version":1,"cards":[{"id":"one","front":"ok","back":""},{"id":"one","front":"ok","back":""}]}"#
        ] { XCTAssertThrowsError(try store.importCards(Data(body.utf8))) }
        XCTAssertTrue(try store.load().isEmpty)
    }
    func testImmutableEventsAndTombstones() throws {
        let store = try temporaryStore()
        var event = SyncEvent(kind: .add, card: Card(id: "x", front: "x", back: ""))
        XCTAssertTrue(try store.append([event]))
        XCTAssertFalse(try store.append([event, event]))
        event.card?.front = "tampered"
        XCTAssertThrowsError(try store.append([event]))
        try store.append([SyncEvent(kind: .delete, cardId: "x")])
        XCTAssertThrowsError(try store.importCards(OpenFormat.encode(CardFile(cards: [Card(id: "x", front: "x", back: "")]))))
        XCTAssertTrue(Library(events: try store.load()).cards.isEmpty)
    }
    func testBatchSyncDeduplicatesAndRejectsConflictsBeforeWriting() throws {
        let store = try temporaryStore()
        let first = SyncEvent(kind: .add, card: Card(id: "first", front: "first", back: ""))
        let next = SyncEvent(kind: .add, card: Card(id: "next", front: "next", back: ""))
        try store.append([first])
        let fileCount = try store.files().count
        XCTAssertFalse(try store.appendBatches([[first], [first]]))
        XCTAssertEqual(try store.files().count, fileCount)
        var conflict = first
        conflict.card?.front = "changed"
        XCTAssertThrowsError(try store.appendBatches([[next], [conflict]]))
        XCTAssertEqual(try store.load().map(\.id), [first.id])
        XCTAssertTrue(try store.appendBatches([[first, next], [next]]))
        XCTAssertEqual(Set(try store.load().map(\.id)), Set([first.id, next.id]))
        let reopened = try JSONEventStore(directory: store.directory)
        XCTAssertFalse(try reopened.appendBatches([[next], [first]]))
    }
    func testConcurrentLocalAppendAndSyncKeepBothTransactions() throws {
        let store = try temporaryStore()
        DispatchQueue.concurrentPerform(iterations: 12) { index in
            do {
                let event = SyncEvent(kind: .add, card: Card(id: "concurrent-\(index)", front: "word", back: ""))
                if index.isMultiple(of: 2) { try store.append([event]) }
                else { try store.appendBatches([[event], [event]]) }
            } catch { XCTFail("Concurrent transaction failed: \(error)") }
        }
        XCTAssertEqual(try store.load().count, 12)
        XCTAssertEqual(Library(events: try store.load()).cards.count, 12)
    }
    func testDayValidationRetainsStrictCalendarChecks() {
        for day in ["2024-02-29", "2026-10-05", "2000-02-29"] { XCTAssertTrue(OpenFormat.validDay(day)) }
        for day in ["2025-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "2026-01-00", "1900-02-29"] { XCTAssertFalse(OpenFormat.validDay(day)) }
    }
    func testModelConfigsSyncButCardExportExcludesCredentials() throws {
        let store = try temporaryStore()
        var config = APIConfig(); config.apiKey = "fixture-secret"
        let batch = EventFile(events: [SyncEvent(kind: .add, card: Card(front: "word", back: "meaning")), SyncEvent(kind: .llmConfig, config: config), SyncEvent(kind: .imageConfig, config: config), SyncEvent(kind: .seed)])
        try store.append(batch.events)
        let shared = try EventFile.decode(OpenFormat.encode(batch.shareable))
        XCTAssertEqual(shared.events.count, 3)
        XCTAssertEqual(Library(events: shared.events).llm, config)
        XCTAssertEqual(Library(events: shared.events).image, config)
        XCTAssertFalse(String(decoding: try store.exportCards(), as: UTF8.self).contains("fixture-secret"))
    }
    func assertSame(_ a: Library, _ b: Library, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(a.cards, b.cards, file: file, line: line)
        XCTAssertEqual(a.progress, b.progress, file: file, line: line)
        XCTAssertEqual(a.stats, b.stats, file: file, line: line)
        XCTAssertEqual(a.controls, b.controls, file: file, line: line)
        XCTAssertEqual(a.issued, b.issued, file: file, line: line)
        XCTAssertEqual(a.deckIssued, b.deckIssued, file: file, line: line)
        XCTAssertEqual(a.reviewHeads, b.reviewHeads, file: file, line: line)
        XCTAssertEqual(try OpenFormat.encode(a.reviews), try OpenFormat.encode(b.reviews), file: file, line: line)
    }
    func testCachedReducerMatchesReplayThroughStudyAndStructuralChanges() throws {
        let store = try temporaryStore()
        var a = Card(id: "a", front: "a", back: ""), b = Card(id: "b", front: "b", back: "")
        a.noteId = "note"; b.noteId = "note"
        try store.append([SyncEvent(kind: .add, card: a), SyncEvent(kind: .add, card: b)])
        _ = try store.snapshot()
        let issued = try store.commit { $0.issueEvents(["a"]) }
        XCTAssertFalse(issued.events.isEmpty)
        for grade in [ReviewGrade.again, .hard, .good, .easy] {
            let result = try store.commit { library in
                let review = library.reviewEvent(cardId: "a", grade: grade)
                return [review] + library.siblingEvents(for: a, reviewID: review.id)
            }
            try assertSame(result.snapshot.library, Library(events: store.load()))
        }
        let head = try store.snapshot().library.reviewHeads["a"]!
        let undo = try store.commit { [try $0.undoEvent(head)] }
        try assertSame(undo.snapshot.library, Library(events: store.load()))
        var lateControl = SyncEvent(kind: .cardControl, cardId: "b")
        var control = CardControl(); control.buriedUntil = Day.adding(1, to: Day.key()); control.buriedBy = head
        lateControl.control = control
        try store.append([lateControl])
        try assertSame(store.snapshot().library, Library(events: store.load()))
        var old = SyncEvent(kind: .review, progress: SchedulingState(cardId: "a")); old.timestamp = 1
        try store.appendBatches([[old], [old]])
        try assertSame(store.snapshot().library, Library(events: store.load()))
        try store.append([SyncEvent(kind: .delete, cardId: "a")])
        try store.append([SyncEvent(kind: .issued, cardId: "a")])
        try assertSame(store.snapshot().library, Library(events: store.load()))
        var restore = SyncEvent(kind: .restore); restore.restoredEvents = [SyncEvent(kind: .add, card: a)]
        try store.append([restore])
        try assertSame(store.snapshot().library, Library(events: store.load()))
        let revision = try store.snapshot().revision
        XCTAssertFalse(try store.append([restore]))
        XCTAssertEqual(try store.snapshot().revision, revision)
    }
    func testFailedWriteDoesNotPublishNewProgress() throws {
        let store = try temporaryStore()
        try store.append([SyncEvent(kind: .add, card: Card(id: "a", front: "a", back: ""))])
        let eventsURL = store.directory.appendingPathComponent("events")
        let original = store.directory.appendingPathComponent("saved-events")
        try FileManager.default.moveItem(at: eventsURL, to: original)
        try Data().write(to: eventsURL) // deterministic failure, even when running as root
        XCTAssertThrowsError(try store.commit { [$0.reviewEvent(cardId: "a", grade: .good)] })
        try FileManager.default.removeItem(at: eventsURL)
        try FileManager.default.moveItem(at: original, to: eventsURL)
        XCTAssertNil(try store.snapshot().library.progress["a"]?.lastReviewedAt)
    }
    func testBackgroundStorageDoesNotWaitForSyncExecutor() async throws {
        let store = try temporaryStore()
        let started = expectation(description: "sync held")
        let release = DispatchSemaphore(value: 0)
        EventWorkers.sync.async { started.fulfill(); _ = release.wait(timeout: .now() + 5) }
        await fulfillment(of: [started], timeout: 2)
        defer { release.signal() }
        let before = Date()
        let result = try await EventWorkers.run {
            try store.commit { _ in [SyncEvent(kind: .add, card: Card(id: "a", front: "a", back: ""))] }
        }
        XCTAssertLessThan(Date().timeIntervalSince(before), 1)
        XCTAssertEqual(result.snapshot.library.cards.count, 1)
    }

}
