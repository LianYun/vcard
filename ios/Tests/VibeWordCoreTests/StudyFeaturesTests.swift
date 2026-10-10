import XCTest
@testable import VibeWordCore

final class StudyFeaturesTests: XCTestCase {
    let day = "2026-10-04"
    var now: Double { Day.calendar.date(from: DateComponents(year: 2026, month: 10, day: 4, hour: 12))!.timeIntervalSince1970 * 1000 }
    func testStudyEngineMatchesTypeScriptFixtures() throws {
        struct Fixture: Decodable { var previous: SchedulingState; var quality: Int; var now: Double; var next: SchedulingState }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "study-parity", withExtension: "json", subdirectory: "Fixtures"))
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        XCTAssertEqual(fixtures.count, 32)
        for fixture in fixtures { XCTAssertEqual(StudyEngine.grade(fixture.previous, quality: ReviewGrade(rawValue: fixture.quality)!, now: fixture.now), fixture.next) }
    }
    func testUndoAlsoRestoresSiblingAvailability() throws {
        var a = Card(id:"a",front:"one",back:"一"), b = Card(id:"b",front:"一",back:"one")
        a.noteId="pair";b.noteId="pair"
        let events = [SyncEvent(kind:.add,card:a),SyncEvent(kind:.add,card:b)]
        let library = Library(events:events), review = library.reviewEvent(cardId:"a",grade:.easy)
        let graded = events + [review] + library.siblingEvents(for:a,reviewID:review.id)
        XCTAssertFalse(Library(events:graded).controls["b"]!.available())
        let restored = Library(events:graded + [try Library(events:graded).undoEvent(review.id)])
        XCTAssertTrue(restored.controls["b"]!.available())
    }
    func testLearningSurvivesRoundTripAndGraduates() throws {
        var state = SchedulingState(cardId: "a", due: day); state.issuedAt = day
        let first = StudyEngine.grade(state, quality: .good, now: now)
        XCTAssertEqual(first.learningDue, now + 600000)
        let decoded = try JSONDecoder().decode(SchedulingState.self, from: JSONEncoder().encode(first))
        XCTAssertFalse(StudyEngine.isDue(decoded, day: day, now: now + 599999))
        XCTAssertTrue(StudyEngine.isDue(decoded, day: day, now: now + 600000))
        let next = StudyEngine.grade(decoded, quality: .good, now: now + 600000)
        XCTAssertNil(next.learningDue); XCTAssertEqual(next.due, "2026-10-05"); XCTAssertEqual(next.phase, "review")
    }
    func testAheadIncludesOnlyRequestedFutureWindow() {
        let cards = (0...6).map { Card(id: "\($0)", front: "word", back: "") }
        let progress = Dictionary(uniqueKeysWithValues: cards.enumerated().map { index,card in
            var s = SchedulingState(cardId:card.id,due:Day.adding(index,to:day)); s.lastReviewedAt = now - 86400000
            return (card.id,s)
        })
        XCTAssertEqual(StudyEngine.ahead(cards:cards,progress:progress,controls:[:],days:1,today:day).map(\.id),["1"])
        XCTAssertEqual(StudyEngine.ahead(cards:cards,progress:progress,controls:["2":CardControl(suspended:true),"3":CardControl(buriedUntil:"2026-10-05")],days:5,today:day).map(\.id),["1","4","5"])
        XCTAssertTrue(StudyEngine.ahead(cards:cards,progress:progress,controls:[:],days:6,today:day).isEmpty)
        let next = StudyEngine.grade(progress["5"]!, quality:.good, now:now)
        XCTAssertEqual(next.due,"2026-10-05") // Based on real study date, not the former due date.
    }
    func testUnreviewedSeedsAreNewUntilIssued() {
        let seed = SchedulingState(cardId:"a",due:day)
        XCTAssertTrue(StudyEngine.isNew(seed))
        let card = Card(id:"a",front:"a",back:"")
        var issue = SyncEvent(kind:.issued,cardId:"a"); issue.day=day
        let library=Library(events:[SyncEvent(kind:.add,card:card),SyncEvent(kind:.seed,progress:seed),issue])
        XCTAssertFalse(StudyEngine.isNew(library.progress["a"]))
        XCTAssertEqual(library.issued[day]?.count,1)
    }
    func testUndoRemovesRatingFromProgressAndStatisticsAndRejectsStaleUndo() throws {
        let card=Card(id:"a",front:"a",back:"")
        var add=SyncEvent(kind:.add,card:card); add.timestamp=now/1000-2
        var seed=SyncEvent(kind:.seed,progress:SchedulingState(cardId:"a",due:day)); seed.timestamp=now/1000-1
        let events=[add,seed]
        let first=Library(events:events).reviewEvent(cardId:"a",grade:.easy,now:now)
        let graded=Library(events:events+[first])
        var undo=try graded.undoEvent(first.id); undo.timestamp=now/1000+1
        let restored=Library(events:events+[first,undo])
        XCTAssertEqual(restored.progress["a"],seed.progress)
        XCTAssertEqual(restored.stats[day]?.reviewed,0)
        XCTAssertTrue(restored.reviews[0].undone)
        let later=graded.reviewEvent(cardId:"a",grade:.hard,now:now+2000)
        XCTAssertThrowsError(try Library(events:events+[first,later]).undoEvent(first.id))
        undo.timestamp=now/1000+3
        let merged=Library(events:[undo,later,first]+events)
        XCTAssertEqual(merged.progress["a"],later.progress)
        XCTAssertFalse(merged.reviews[0].undone)
    }
    func testBackupRestoresDeletedCardsAndRetainsCurrentBackup() async throws {
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:folder) }
        let storage=try JSONEventStore(directory:folder)
        let card=Card(id:"a",front:"word",back:"meaning")
        try storage.append([SyncEvent(kind:.add,card:card)])
        let name=try storage.createBackup()
        try storage.append([SyncEvent(kind:.delete,cardId:"a")])
        XCTAssertTrue(Library(events:try storage.load()).cards.isEmpty)
        try storage.append([storage.restoreEvent(name)])
        XCTAssertEqual(Library(events:try storage.load()).cards.map(\.id),["a"])
        _ = try await EventWorkers.run(on: EventWorkers.sync) { () }
        XCTAssertGreaterThanOrEqual(try storage.backupFiles().count,3)
        XCTAssertThrowsError(try storage.restoreEvent("../../outside.json"))
    }
    func testRelearningDoesNotAdvanceLongTermRepetitionsUntilGraduation() {
        var previous=SchedulingState(cardId:"a",due:day); previous.lastReviewedAt=now-86400000
        previous.interval=30;previous.repetitions=8;previous.phase="review"
        let again=StudyEngine.grade(previous,quality:.again,now:now)
        XCTAssertEqual(again.phase,"relearning");XCTAssertEqual(again.learningDue,now+60000);XCTAssertEqual(again.repetitions,0)
        let step=StudyEngine.grade(again,quality:.good,now:now+60000)
        XCTAssertEqual(step.learningDue,now+660000)
        let graduated=StudyEngine.grade(step,quality:.good,now:now+660000)
        XCTAssertEqual(graduated.repetitions,1);XCTAssertEqual(graduated.interval,1)
    }
}
