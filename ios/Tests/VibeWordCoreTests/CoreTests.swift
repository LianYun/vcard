import XCTest
@testable import VibeWordCore

final class CoreTests: XCTestCase {
    struct Fixtures: Decodable {
        struct Grade: Decodable { var previous: SchedulingState; var quality: Int; var next: SchedulingState }
        var cardsPrompt: String; var imagePrompt: String
        var grades: [Grade]; var cards: [Card]; var markdown: String
    }
    func testTypeScriptParity() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "parity", withExtension: "json", subdirectory: "Fixtures"))
        let fixtures = try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
        XCTAssertEqual(Prompts.cards, fixtures.cardsPrompt)
        XCTAssertEqual(Prompts.image, fixtures.imagePrompt)
        XCTAssertEqual(fixtures.grades.count, 192)
        for fixture in fixtures.grades {
            let result = SM2.grade(fixture.previous, quality: ReviewGrade(rawValue: fixture.quality)!, on: "2026-09-30", at: 123456)
            XCTAssertEqual(result.ease, fixture.next.ease, accuracy: 1e-12)
            XCTAssertEqual(result.interval, fixture.next.interval)
            XCTAssertEqual(result.repetitions, fixture.next.repetitions)
            XCTAssertEqual(result.due, fixture.next.due)
            XCTAssertEqual(result.lastReviewedAt, fixture.next.lastReviewedAt)
        }
        XCTAssertEqual(Obsidian.markdown(fixtures.cards), fixtures.markdown)
    }
    func testCalendarBoundaries() {
        XCTAssertEqual(Day.adding(1, to: "2024-02-28"), "2024-02-29")
        XCTAssertEqual(Day.adding(1, to: "2026-12-31"), "2027-01-01")
        XCTAssertEqual(Day.adding(-1, to: "2026-03-01"), "2026-02-28")
        XCTAssertEqual(Day.adding(1, to: "2026-03-08"), "2026-03-09")
    }
    func testScheduleBudgetAndSeededCards() {
        let cards = (0..<8).map { Card(id: "\($0)", front: "\($0)", back: "") }
        var progress = ["0": SchedulingState(cardId: "0", due: "2026-09-30"), "1": SchedulingState(cardId: "1", due: "2026-10-01")]
        progress["0"]?.issuedAt = "2026-09-30"
        progress["1"]?.issuedAt = "2026-09-30"
        let result = Schedule.make(cards: cards, progress: progress, limit: 3, issued: 1, today: "2026-09-30")
        XCTAssertEqual(result.due.map(\.id), ["0"])
        XCTAssertEqual(result.fresh.count, 2)
        XCTAssertTrue(result.fresh.allSatisfy { progress[$0.id] == nil })
        let none = Schedule.make(cards: cards, progress: progress, limit: 0, issued: 0, today: "2026-09-30")
        XCTAssertTrue(none.fresh.isEmpty)
        XCTAssertEqual(none.due.count, 1)
    }
    func testOfflineMergeAndDuplicateImport() {
        let a = Card(front: "apple", back: "苹果"), b = Card(front: "book", back: "书")
        let events = [SyncEvent(kind: .add, card: a), SyncEvent(kind: .add, card: b),
                      SyncEvent(kind: .review, progress: SM2.grade(SchedulingState(cardId: a.id), quality: .good)),
                      SyncEvent(kind: .review, progress: SM2.grade(SchedulingState(cardId: b.id), quality: .hard))]
        let first = Library(events: events)
        let merged = Library(events: events.reversed() + events)
        XCTAssertEqual(first.cards, merged.cards)
        XCTAssertEqual(first.progress, merged.progress)
        XCTAssertEqual(merged.stats[Day.key()]?.added, 2)
        XCTAssertEqual(merged.stats[Day.key()]?.reviewed, 2)
    }
    func testDeletionWinsAgainstStaleEditAndReview() {
        var card = Card(front: "test", back: "测试")
        let add = SyncEvent(kind: .add, card: card)
        let deletion = SyncEvent(kind: .delete, cardId: card.id)
        card.front = "stale offline edit"
        let events = [add, deletion, SyncEvent(kind: .edit, card: card),
                      SyncEvent(kind: .review, progress: SchedulingState(cardId: card.id))]
        let library = Library(events: events)
        XCTAssertTrue(library.cards.isEmpty)
        XCTAssertTrue(library.progress.isEmpty)
        XCTAssertEqual(library.stats[Day.key()]?.reviewed, 1)
    }
    func testSeedCannotOverwriteReviewAndDailyIssueDeduplication() {
        let card = Card(front: "test", back: "")
        let state = SM2.grade(SchedulingState(cardId: card.id), quality: .easy)
        let events = [SyncEvent(kind: .add, card: card), SyncEvent(kind: .review, progress: state),
                      SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id)),
                      SyncEvent(kind: .issued, cardId: card.id), SyncEvent(kind: .issued, cardId: card.id)]
        let library = Library(events: events)
        XCTAssertEqual(library.progress[card.id], state)
        XCTAssertEqual(library.issued[Day.key()]?.count, 1)
        XCTAssertNil(library.issued[Day.adding(1, to: Day.key())])
    }
    func testConfigConflictDeterministicAcrossImportOrder() {
        var a = SyncEvent(kind: .studyConfig, limit: 20); a.timestamp = 42; a.id = "a"
        var b = SyncEvent(kind: .studyConfig, limit: 30); b.timestamp = 42; b.id = "b"
        XCTAssertEqual(Library(events: [a,b]).newCardsPerDay, 30)
        XCTAssertEqual(Library(events: [b,a]).newCardsPerDay, 30)
    }
    func testJSONExtractionAndEventRoundTrip() throws {
        for value in ["```json\n{\"word\":\"test\"}\n```", "Here: {\"word\":\"test\"}", "{\"word\":\"test\"}"] {
            let result = try JSONDecoder().decode([String: String].self, from: GenerationService.extractJSON(value))
            XCTAssertEqual(result["word"], "test")
        }
        var config = APIConfig(); config.apiKey = "test-only"; config.model = "model"; config.baseURL = "https://example.com/v1"
        let event = SyncEvent(kind: .llmConfig, config: config)
        let decoded = try JSONDecoder().decode(SyncEvent.self, from: JSONEncoder().encode(event))
        XCTAssertEqual(Library(events: [decoded]).llm, config)
    }
}

private final class MockAPI: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

extension CoreTests {
    func testGenerationAndOptionalImageFailure() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAPI.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); MockAPI.handler = nil }
        var config = APIConfig()
        config.baseURL = "https://example.invalid/v1"; config.apiKey = "test-only"; config.model = "mock"
        let word: [String: String] = ["word": "test", "phonetic": "/test/", "definition": "测试", "example": "A test.",
            "exampleTranslation": "一个测试。", "etymology": "origin", "roots": "root", "similar": "trial", "chineseHint": "测试"]
        let content = String(decoding: try JSONSerialization.data(withJSONObject: word), as: UTF8.self)
        var chats = 0
        var images = 0
        MockAPI.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only")
            if request.url!.path.hasSuffix("/images/generations") {
                images += 1
                return (500, Data("provider failure".utf8))
            }
            chats += 1
            return (200, try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": chats == 1 ? content : "A scene"]]]]))
        }
        let cards = try await GenerationService(session: session).generate(word: "test", config: config, image: config)
        XCTAssertEqual(chats, 2); XCTAssertEqual(images, 1)
        XCTAssertEqual(cards.count, 2)
        XCTAssertEqual(cards[0].front, "test")
        XCTAssertTrue(cards[0].back.contains("**词根** root"))
        XCTAssertFalse(cards[0].back.contains("!["))
        XCTAssertEqual(cards[1].front, "测试\n（提示：root）")
        XCTAssertEqual(cards[1].back, "test"); XCTAssertEqual(cards[1].example, "A test.")
    }
    func testGenerationRejectsMalformedFields() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAPI.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); MockAPI.handler = nil }
        MockAPI.handler = { _ in
            (200, try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": "{}"]]]]))
        }
        var config = APIConfig(); config.baseURL = "https://example.invalid/v1"
        do {
            _ = try await GenerationService(session: session).generate(word: "test", config: config, image: APIConfig())
            XCTFail("Malformed response must not become cards")
        } catch { XCTAssertEqual(error.localizedDescription, "无法解析模型返回的 JSON，请重试") }
    }
}
