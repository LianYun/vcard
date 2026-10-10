import XCTest
@testable import VibeWordCore

final class LocalStudySessionTests: XCTestCase {
    func testRandomizedQueueSpacesSiblingsAndPreservesCards() {
        for counts in [[2, 2, 2], [3, 2, 1], [4, 3], [2, 1, 1], [5, 1], [1], []] {
            let cards = counts.enumerated().flatMap { group, count in
                (0..<count).map { index in
                    var card = Card(id: "\(group)-\(index)", front: "word", back: "answer")
                    card.noteId = "note-\(group)"
                    return card
                }
            }
            for _ in 0..<100 {
                let ordered = shuffleStudyCards(cards)
                XCTAssertEqual(ordered.map(\.id).sorted(), cards.map(\.id).sorted())
                if (counts.max() ?? 0) <= (cards.count + 1) / 2 {
                    XCTAssertTrue(zip(ordered, ordered.dropFirst()).allSatisfy { $0.noteId != $1.noteId })
                }
            }
        }
        let cards = (0..<10).map { Card(id: String($0), front: "word", back: "answer") }
        let orders = Set((0..<20).map { _ in shuffleStudyCards(cards).map(\.id).joined(separator: ",") })
        XCTAssertGreaterThan(orders.count, 1)
    }

    func testResumeDropsChangedDeletedAndSuspendedCardsWithoutIssuingNewCards() throws {
        let day = "2026-10-04"
        let cards = ["a", "b", "c", "d"].map { Card(id: $0, front: $0, back: "answer") }
        let events = cards.flatMap { card in [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id, due: day))] }
        let library = Library(events: events)
        let saved = LocalStudySession(day: day, ids: ["b", "a", "c", "d"], progress: library.progress, done: 2, total: 6, relearned: 1, aheadDays: 0, scope: StudyScope())
        let decoded = try JSONDecoder().decode(LocalStudySession.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(decoded.remaining(in: library, today: day).map(\.id), ["b", "a", "c", "d"])
        XCTAssertTrue(decoded.remaining(in: library, today: "2026-10-05").isEmpty)
        var changed = library
        changed.cards.removeAll { $0.id == "c" }
        changed.progress["b"]?.lastReviewedAt = 1000
        var control = CardControl(); control.suspended = true
        changed.controls["d"] = control
        XCTAssertEqual(decoded.remaining(in: changed, today: day).map(\.id), ["a"])
        XCTAssertEqual(decoded.done, 2)
        XCTAssertEqual(changed.issued, library.issued)
    }
}
