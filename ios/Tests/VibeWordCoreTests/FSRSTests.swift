import XCTest
@testable import VibeWordCore
final class FSRSTests: XCTestCase {
    struct Fixture: Decodable { var previous: SchedulingState; var config: SchedulerConfig; var now: Double; var quality: Int; var next: SchedulingState }
    func testTypeScriptParity() throws {
        let url = Bundle.module.url(forResource: "fsrs-parity", withExtension: "json", subdirectory: "Fixtures")!
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        for f in fixtures {
            let next = FSRSScheduler.preview(f.previous, config: f.config, now: f.now)[ReviewGrade(rawValue: f.quality)!]!
            XCTAssertEqual(next.interval, f.next.interval)
            XCTAssertEqual(next.due, f.next.due)
            XCTAssertEqual(next.phase, f.next.phase)
            XCTAssertEqual(next.learningDue, f.next.learningDue)
            XCTAssertEqual(next.learningStep, f.next.learningStep)
            XCTAssertEqual(next.fsrs!.stability, f.next.fsrs!.stability, accuracy: 0.000001)
            XCTAssertEqual(next.fsrs!.difficulty, f.next.fsrs!.difficulty, accuracy: 0.000001)
        }
    }
    func testOptimizerParity() throws {
        struct Input: Decodable { var history: [ReviewRecord]; var config: SchedulerConfig; var result: OptimizationResult }
        let url = Bundle.module.url(forResource: "fsrs-optimizer", withExtension: "json", subdirectory: "Fixtures")!
        let input = try JSONDecoder().decode(Input.self, from: Data(contentsOf: url))
        let result = try FSRSScheduler.optimize(input.history, config: input.config)
        XCTAssertEqual(result.accepted, input.result.accepted)
        XCTAssertEqual(result.validation, input.result.validation)
        XCTAssertEqual(result.baselineLoss, input.result.baselineLoss, accuracy: 0.000001)
        XCTAssertEqual(result.candidateLoss, input.result.candidateLoss, accuracy: 0.000001)
        for (a,b) in zip(result.config.weights,input.result.config.weights) { XCTAssertEqual(a,b,accuracy:0.000001) }
    }
    func testMigrationAndConfigRoundTrip() throws {
        let now = Date().timeIntervalSince1970 * 1000
        var old = SchedulingState(cardId: "card"); old.lastReviewedAt = now - 86400000; old.interval = 15; old.phase = "review"
        let migrated = FSRSScheduler.migrate(old)
        XCTAssertEqual(migrated.due, old.due)
        XCTAssertEqual(migrated.fsrs?.source, "estimated")
        let card = Card(id: "card", front: "hello", back: "你好")
        var config = SchedulerConfig(); config.id = "personal"; config.retention = 0.95
        var event = SyncEvent(kind: .fsrsConfig); event.schedulerConfig = config
        let events = [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: old), event]
        let library = Library(events: try EventFile.decode(OpenFormat.encode(EventFile(events: events))).events)
        XCTAssertEqual(library.schedulerConfig, config)
        let context = ReviewContext(now: now, configId: config.id, before: library.preparedState("card"))
        XCTAssertEqual(try library.validateReviewContext(context, cardID: "card"), now)
        XCTAssertThrowsError(try library.validateReviewContext(ReviewContext(now: now, configId: "stale", before: old), cardID: "card"))
        let review = library.reviewEvent(cardId: "card", grade: .good, now: now)
        XCTAssertEqual(review.algorithm, FSRSScheduler.algorithm)
        XCTAssertEqual(review.schedulerConfig, config)
        let after = Library(events: events + [review])
        let undo = try after.undoEvent(review.id)
        XCTAssertEqual(Library(events: events + [review, undo]).progress["card"], old)
        XCTAssertThrowsError(try FSRSScheduler.optimize([], config: config))
        var invalid = config; invalid.weights = [1]
        XCTAssertThrowsError(try invalid.validate())
    }
}
