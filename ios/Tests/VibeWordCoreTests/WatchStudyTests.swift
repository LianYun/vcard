import XCTest
@testable import VibeWordCore

final class WatchStudyTests: XCTestCase {
    private let day = "2026-10-03"
    private var now: Date { Day.calendar.date(from: DateComponents(year: 2026, month: 10, day: 3, hour: 12))! }
    private func fixture(count: Int = 6) throws -> (WatchStudy, [SyncEvent]) {
        var state = WatchStudy()
        let events = (0..<count).flatMap { i -> [SyncEvent] in
            let card = Card(id: "custom:\(i)", front: "word \(i)", back: "释义")
            var progress = SchedulingState(cardId: card.id, due: day)
            progress.lastReviewedAt = now.timeIntervalSince1970 * 1000 - 86400000
            progress.phase = "review"
            return [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: progress)]
        }
        try state.apply(WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID, revision: 1))
        return (state, events)
    }
    func testFiveCardRoundPersistsAndAgainDoesNotCompleteCard() throws {
        var (state, _) = try fixture()
        state.start(on: day)
        XCTAssertEqual(state.round.queue.count, 5)
        let first = try XCTUnwrap(state.current?.id)
        state.round.flipped = true
        let restored = try JSONDecoder().decode(WatchStudy.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored.round.queue, state.round.queue)
        XCTAssertTrue(restored.round.flipped)
        state.start(on: day)
        XCTAssertEqual(state.round.queue, restored.round.queue)
        try state.review(.again, now: now)
        XCTAssertTrue(state.round.queue.contains(first))
        XCTAssertEqual(state.progress[first]?.learningDue, now.timeIntervalSince1970 * 1000 + 600000)
        XCTAssertEqual(state.round.done, 0)
        XCTAssertEqual(state.round.relearned, 1)
        XCTAssertFalse(state.round.flipped)
        for _ in 0..<5 { try state.review(.easy, now: now.addingTimeInterval(601)) }
        XCTAssertTrue(state.round.isFinished)
        XCTAssertEqual(state.round.done, 5)
        XCTAssertEqual(state.pending.count, 6)
        XCTAssertEqual(state.reviewed(on: day), 6)
    }
    func testStaleSnapshotCannotRollbackPendingReviewOrLoseOutbox() throws {
        var (state, events) = try fixture(count: 1)
        state.start(on: day)
        try state.review(.good, now: now)
        let progress = state.progress
        try state.apply(WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID, revision: 2))
        XCTAssertEqual(state.progress, progress)
        XCTAssertEqual(state.pending.count, 1)
        let pending = state.pending[0]
        let accepted = WatchSnapshot(events: events + [pending.event], sourceID: "phone", deviceID: state.deviceID,
                                     revision: 3, acknowledgedIDs: [pending.id])
        try state.apply(accepted)
        XCTAssertTrue(state.pending.isEmpty)
        XCTAssertEqual(state.progress, progress)
        XCTAssertEqual(state.reviewed(on: day), 1)
        try state.apply(accepted) // Duplicate file + foreground delivery.
        try state.apply(WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID, revision: 2))
        XCTAssertEqual(state.progress, progress)
        XCTAssertEqual(state.reviewed(on: day), 1)
    }
    func testPhoneLaterReviewWinsOverUnacknowledgedOlderWatchReview() throws {
        var (state, events) = try fixture(count: 1)
        state.start(on: day); try state.review(.easy, now: now)
        var phone = Library(events: events).reviewEvent(cardId: "custom:0", grade: .again, now: now.timeIntervalSince1970 * 1000 + 1000)
        phone.timestamp = now.timeIntervalSince1970 + 1
        try state.apply(WatchSnapshot(events: events + [phone], sourceID: "phone", deviceID: state.deviceID, revision: 2))
        XCTAssertEqual(state.progress["custom:0"], phone.progress)
        XCTAssertEqual(state.pending.count, 1) // Still needs durable import for activity history.
    }
    func testDeleteWinsAndRemovesActiveCardButRetainsPendingActivity() throws {
        var (state, events) = try fixture(count: 1)
        state.start(on: day); try state.review(.again, now: now)
        try state.apply(WatchSnapshot(events: events + [SyncEvent(kind: .delete, cardId: "custom:0")],
                                     sourceID: "phone", deviceID: state.deviceID, revision: 2))
        XCTAssertNil(state.current)
        XCTAssertTrue(state.progress.isEmpty)
        XCTAssertTrue(state.round.queue.isEmpty)
        XCTAssertEqual(state.round.removed, 1)
        XCTAssertEqual(state.pending.count, 1)
    }
    func testOnlyDurablyPresentEventsCanBeAcknowledged() throws {
        var (state, events) = try fixture(count: 1)
        state.start(on: day); try state.review(.good, now: now)
        let snapshot = WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID,
                                     revision: 2, acknowledgedIDs: [state.pending[0].id])
        XCTAssertTrue(snapshot.acknowledgedIDs.isEmpty)
        try state.apply(snapshot)
        XCTAssertEqual(state.pending.count, 1)
    }
    func testDeletingFlippedCardReturnsNextCardToRecall() throws {
        var (state, events) = try fixture(count: 2)
        state.start(on: day); state.round.flipped = true
        let removed = try XCTUnwrap(state.current?.id)
        try state.apply(WatchSnapshot(events: events + [SyncEvent(kind: .delete, cardId: removed)],
                                     sourceID: "phone", deviceID: state.deviceID, revision: 2))
        XCTAssertFalse(state.round.flipped)
        XCTAssertEqual(state.round.queue.count, 1)
        try state.validate()
    }
    func testDifferentPhoneAndWrongDeviceDoNotDiscardPendingData() throws {
        var (state, events) = try fixture(count: 1)
        state.start(on: day); try state.review(.good, now: now)
        XCTAssertThrowsError(try state.apply(WatchSnapshot(events: events, sourceID: "another-phone", deviceID: state.deviceID, revision: 10)))
        XCTAssertThrowsError(try state.apply(WatchSnapshot(events: events, sourceID: "phone", deviceID: UUID().uuidString, revision: 10)))
        XCTAssertEqual(state.pending.count, 1)
        XCTAssertEqual(state.snapshot?.sourceID, "phone")
    }
    func testSnapshotExcludesCredentialsImagesAndUnintroducedCards() throws {
        let (state, original) = try fixture(count: 1)
        var config = APIConfig(); config.apiKey = "TEST_SECRET_NEVER_SEND"
        let card = Card(id: "custom:0", front: "**word**", back: "meaning\n![picture](data:image/png;base64,SECRET_IMAGE)\nfull definition")
        let events = original + [SyncEvent(kind: .llmConfig, config: config), SyncEvent(kind: .edit, card: card),
                                 SyncEvent(kind: .add, card: Card(front: "not introduced", back: "new"))]
        let snapshot = WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID, revision: 2)
        let json = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        XCTAssertFalse(json.contains(config.apiKey))
        XCTAssertFalse(json.contains("SECRET_IMAGE"))
        XCTAssertEqual(snapshot.cards.count, 1)
        XCTAssertEqual(snapshot.cards[0].front, "word")
        XCTAssertTrue(snapshot.cards[0].back.contains("full definition"))
    }
    func testOfflineDateRolloverUsesSharedCalendarAndIntroducesNoFreshCards() throws {
        var (state, _) = try fixture(count: 1)
        state.start(on: day); try state.review(.good, now: now)
        XCTAssertTrue(state.due(on: day).isEmpty)
        XCTAssertEqual(state.due(on: state.progress["custom:0"]!.due).count, 1)
        state.start(on: state.progress["custom:0"]!.due)
        XCTAssertEqual(state.round.total, 1)
    }
    func testInvalidWireDataIsRejectedBeforeDateArithmetic() throws {
        var (state, events) = try fixture(count: 1)
        var incoming = WatchSnapshot(events: events, sourceID: "phone", deviceID: state.deviceID, revision: 2)
        incoming.progress["custom:0"]?.due = "2026-02-31"
        XCTAssertThrowsError(try state.apply(incoming))
        XCTAssertEqual(state.snapshot?.revision, 1)
    }
}
