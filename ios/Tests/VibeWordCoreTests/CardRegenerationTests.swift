import XCTest
@testable import VibeWordCore

final class CardRegenerationTests: XCTestCase {
    func testParsingRejectsInvalidResponses() throws {
        let draft = try RegeneratedCard.parse("```json\n{\"front\":\" Question \",\"back\":\" Answer \",\"example\":\"\"}\n```")
        XCTAssertEqual(draft.front, "Question")
        for text in ["{}", "garbage", "{\"front\":\" \",\"back\":\"A\",\"example\":\"\"}"] {
            XCTAssertThrowsError(try RegeneratedCard.parse(text))
        }
    }
    func testReplacementPreservesProgressAndRejectsStaleDrafts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try JSONEventStore(directory: directory)
        var card = Card(id: "original", front: "Question", back: "Answer", example: "Example")
        card.tags = ["tag"]; card.noteId = "note"; card.deckId = "default"
        let sibling = Card(id: "sibling", front: "Other", back: "Other answer")
        let progress = SM2.grade(SchedulingState(cardId: card.id), quality: .good)
        try store.append([SyncEvent(kind: .add, card: card), SyncEvent(kind: .add, card: sibling), SyncEvent(kind: .review, progress: progress)])
        let before = try store.snapshot().library
        let draft = RegeneratedCard(front: "New question", back: "New answer")
        let result = try store.commit { [try $0.replaceRegeneratedCardEvent(expected: card, draft: draft)] }
        XCTAssertEqual(result.events.count, 1)
        let after = result.snapshot.library
        let updated = try XCTUnwrap(after.cards.first { $0.id == card.id })
        XCTAssertEqual(updated.front, draft.front)
        XCTAssertNil(updated.example)
        XCTAssertEqual(updated.tags, card.tags); XCTAssertEqual(updated.noteId, card.noteId)
        XCTAssertEqual(updated.deckId, card.deckId); XCTAssertEqual(updated.createdAt, card.createdAt)
        XCTAssertEqual(after.progress, before.progress)
        XCTAssertEqual(try OpenFormat.encode(after.reviews), try OpenFormat.encode(before.reviews))
        XCTAssertEqual(after.cards.first { $0.id == sibling.id }, sibling)
        XCTAssertThrowsError(try store.commit { [try $0.replaceRegeneratedCardEvent(expected: card, draft: draft)] })
        try store.append([SyncEvent(kind: .delete, cardId: card.id)])
        XCTAssertThrowsError(try store.commit { [try $0.replaceRegeneratedCardEvent(expected: updated, draft: draft)] })
    }
}
