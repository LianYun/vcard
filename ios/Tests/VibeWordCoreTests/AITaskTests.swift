import XCTest
@testable import VibeWordCore

final class AITaskTests: XCTestCase {
    func testDraftsRemainLocalAndRecoverPaused() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("local-ai/ai-tasks.json")
        var task = AITask(word: "word")
        task.status = "running"
        task.drafts = [AIDraft(id: task.id + ":enToCn", direction: "enToCn", card: Card(front: "word", back: "meaning"))]
        try AITaskFile(tasks: [task]).save(to: url)
        let restored = try AITaskFile.load(from: url)
        XCTAssertEqual(restored[0].status, "paused")
        XCTAssertEqual(restored[0].drafts[0].status, "ready")
        XCTAssertFalse(String(data: try Data(contentsOf: url), encoding: .utf8)!.contains("apiKey"))
        XCTAssertTrue(Library().cards.isEmpty)
    }
    func testIndependentConfirmationReceiptsAndNoResurrection() throws {
        var first = Card(id: "custom:ai:one", front: "word", back: "meaning")
        first.noteId = "pair"
        var second = Card(id: "custom:ai:two", front: "meaning", back: "word")
        second.noteId = "pair"
        var events = try AIConfirmation.events(existing: [], draftID: "one", card: first)
        XCTAssertEqual(Library(events: events).cards.count, 1)
        XCTAssertEqual(Library(events: events).stats[Day.key()]?.added, 1)
        XCTAssertTrue(try AIConfirmation.events(existing: events, draftID: "one", card: first).isEmpty)
        events += try AIConfirmation.events(existing: events, draftID: "two", card: second)
        XCTAssertEqual(Library(events: events).cards.count, 2)
        events.append(SyncEvent(kind: .delete, cardId: first.id))
        XCTAssertTrue(try AIConfirmation.events(existing: events, draftID: "one", card: first).isEmpty)
        // Previously accepted legacy document ID is never resurrected.
        XCTAssertTrue(try AIConfirmation.events(existing: events, draftID: "migrated", card: first).isEmpty)
    }
    func testReplacementKeepsProgressAndChecksMetadata() throws {
        var original = Card(id: "original", front: "q", back: "a")
        original.tags = ["tag"]
        var progress = SchedulingState(cardId: original.id)
        progress.repetitions = 4; progress.interval = 30
        let events = [SyncEvent(kind: .add, card: original), SyncEvent(kind: .seed, progress: progress)]
        var proposed = original; proposed.back = "new answer"; proposed.deckId = "default"
        let confirmed = try AIConfirmation.events(existing: events, draftID: "replacement", card: proposed, expected: original)
        let library = Library(events: events + confirmed)
        XCTAssertEqual(library.progress[original.id], progress)
        XCTAssertEqual(library.stats[Day.key()]?.added, 1)
        XCTAssertEqual(library.cards.first?.back, "new answer")
        XCTAssertTrue(try AIConfirmation.events(existing: events + confirmed, draftID: "replacement", card: proposed, expected: original).isEmpty)
        var changed = original; changed.tags = ["changed"]
        XCTAssertThrowsError(try AIConfirmation.events(existing: events + [SyncEvent(kind: .edit, card: changed)], draftID: "conflict", card: proposed, expected: original))
        XCTAssertThrowsError(try AIConfirmation.events(existing: events + [SyncEvent(kind: .delete, cardId: original.id)], draftID: "deleted", card: proposed, expected: original))
    }
}
