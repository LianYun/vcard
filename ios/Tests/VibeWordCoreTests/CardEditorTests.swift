import XCTest
@testable import VibeWordCore

final class CardEditorTests: XCTestCase {
    func testAtomicContentMetadataEditPreservesIdentityAndProgress() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try JSONEventStore(directory: directory)
        var card = Card(id: "one", front: "Question", back: "Answer", example: "Example")
        card.tags = ["old"]; card.noteId = "note"
        var deck = SyncEvent(kind: .deck); deck.deck = Deck(id: "target", name: "Target")
        let progress = SM2.grade(SchedulingState(cardId: card.id), quality: .good)
        try store.append([SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: progress), deck])
        let before = try store.snapshot().library
        var draft = card; draft.front = " Updated "; draft.back = ""; draft.example = ""; draft.tags = []; draft.deckId = "target"
        let after = try store.commit { try $0.cardEditorEvents(expected: card, draft: draft) }.snapshot.library
        let updated = try XCTUnwrap(after.cards.first)
        XCTAssertEqual(updated.front, "Updated"); XCTAssertEqual(updated.back, "")
        XCTAssertNil(updated.example); XCTAssertEqual(updated.tags, []); XCTAssertEqual(updated.deckId, "target")
        XCTAssertEqual(updated.noteId, card.noteId); XCTAssertEqual(updated.createdAt, card.createdAt)
        XCTAssertEqual(after.progress, before.progress)
        XCTAssertThrowsError(try store.commit { try $0.cardEditorEvents(expected: card, draft: draft) })
        var invalid = updated; invalid.deckId = "missing"
        XCTAssertThrowsError(try store.commit { try $0.cardEditorEvents(expected: updated, draft: invalid) })
        try store.append([SyncEvent(kind: .delete, cardId: card.id)])
        XCTAssertThrowsError(try store.commit { try $0.cardEditorEvents(expected: updated, draft: updated) })
    }

    func testAnkiPreviewDoesNotPersistAndClozeEditKeepsSurvivingProgress() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try JSONEventStore(directory: directory)
        var first = Card(id: "cloze1", front: "[…] B", back: "A B")
        first.noteId = "note"; first.tags = ["shared"]
        first.anki = AnkiNote(guid: "guid", model: "Cloze", fields: ["Text": "{{c1::A}} {{c2::B}}"], question: "{{cloze:Text}}", answer: "{{cloze:Text}}", css: "", ordinal: 0, cloze: true)
        var second = first; second.id = "cloze2"; second.anki?.ordinal = 1
        let progress = SM2.grade(SchedulingState(cardId: first.id), quality: .good)
        try store.append([SyncEvent(kind: .add, card: first), SyncEvent(kind: .add, card: second), SyncEvent(kind: .seed, progress: progress)])
        let fields = ["Text": "{{c1::Changed}} {{c3::New}}"]
        let before = try store.snapshot().library
        let preview = try before.editAnkiEvents(id: first.id, fields: fields)
        XCTAssertEqual(preview.filter { $0.kind == .add }.count, 1)
        XCTAssertEqual(preview.filter { $0.kind == .delete }.count, 1)
        XCTAssertEqual(try store.snapshot().library.cards, before.cards)
        var draft = first; draft.tags = ["edited"]
        let after = try store.commit { try $0.cardEditorEvents(expected: first, draft: draft, fields: fields) }.snapshot.library
        XCTAssertEqual(after.cards.count, 2)
        XCTAssertFalse(after.cards.contains { $0.id == second.id })
        XCTAssertEqual(after.progress[first.id], before.progress[first.id])
        XCTAssertEqual(after.cards.first { $0.id == first.id }?.tags, ["edited"])
        XCTAssertTrue(after.cards.first { $0.id == first.id }!.back.contains("Changed"))
        XCTAssertThrowsError(try after.cardEditorEvents(expected: first, draft: draft, fields: fields))
    }
}
