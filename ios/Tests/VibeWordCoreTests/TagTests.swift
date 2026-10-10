import XCTest
@testable import VibeWordCore

final class TagTests: XCTestCase {
    func testLegacyCardsAndTaggedEventsRoundTrip() throws {
        let old = Data(#"{"id":"old","front":"word","back":"meaning"}"#.utf8)
        let legacy = try JSONDecoder().decode(Card.self, from: old)
        XCTAssertNil(legacy.tags)
        var card = legacy
        card.tags = ["work", "travel"]
        let event = SyncEvent(kind: .edit, card: card)
        let decoded = try JSONDecoder().decode(SyncEvent.self, from: JSONEncoder().encode(event))
        let library = Library(events: [decoded])
        XCTAssertEqual(library.cards.first?.tags, ["work", "travel"])
        XCTAssertTrue(library.progress.isEmpty)
        XCTAssertTrue(library.issued.isEmpty)
        XCTAssertTrue(library.stats.isEmpty)
    }

    func testStudyScopePersistenceAndLegacyUpdate() throws {
        var event = SyncEvent(kind: .studyConfig, limit: 2)
        event.studyScope = StudyScope(tags: ["work", "", "work"])
        let decoded = try JSONDecoder().decode(SyncEvent.self, from: JSONEncoder().encode(event))
        var legacy = SyncEvent(kind: .studyConfig, limit: 3)
        legacy.timestamp = event.timestamp + 1
        var library = Library(events: [decoded, legacy])
        XCTAssertEqual(library.studyScope.tags, ["", "work"])
        XCTAssertEqual(library.newCardsPerDay, 3)
        var reset = SyncEvent(kind: .studyConfig)
        reset.timestamp = legacy.timestamp + 1; reset.studyScope = StudyScope()
        library = Library(events: [decoded, legacy, reset])
        XCTAssertNil(library.studyScope.tags)
    }

    func testScopedPreviewUsesSharedBudgetAndExclusions() {
        var library = Library()
        library.cards = (0..<8).map { Card(id: "c\($0)", front: "word", back: "meaning") }
        library.cards[0].tags = ["work", "travel"]; library.cards[0].noteId = "pair"
        library.cards[1].tags = ["work"]; library.cards[1].noteId = "pair"
        library.cards[2].tags = ["travel"]
        for i in 4..<8 { library.cards[i].tags = ["work"] }
        library.controls["c4"] = CardControl(suspended: true)
        library.controls["c5"] = CardControl(buriedUntil: Day.adding(1, to: Day.key()))
        var future = SchedulingState(cardId: "c6", due: Day.adding(2, to: Day.key()))
        future.lastReviewedAt = 1
        library.progress["c6"] = future
        var due = SchedulingState(cardId: "c7"); due.lastReviewedAt = 1
        library.progress["c7"] = due
        library.newCardsPerDay = 2
        let scope = StudyScope(tags: ["work", "travel"])
        let selection = StudySelection.make(library: library, scope: scope)
        XCTAssertEqual(selection.fresh.map(\.id), ["c0", "c2"])
        XCTAssertEqual(selection.reviews.map(\.id), ["c7"])
        XCTAssertTrue(library.issued.isEmpty)
        library.issued[Day.key()] = ["elsewhere1", "elsewhere2"]
        XCTAssertTrue(StudySelection.make(library: library, scope: scope).fresh.isEmpty)
        XCTAssertEqual(StudySelection.make(library: library, scope: StudyScope(tags: [""])).matching.map(\.id), ["c3"])
        XCTAssertTrue(StudySelection.make(library: library, scope: StudyScope(tags: [])).matching.isEmpty)
        XCTAssertTrue(StudySelection.make(library: library, scope: StudyScope(tags: ["missing"])).matching.isEmpty)
        XCTAssertEqual(StudySelection.make(library: library, scope: StudyScope()).matching.count, 8)
    }
}
