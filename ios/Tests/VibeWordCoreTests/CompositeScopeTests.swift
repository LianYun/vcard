import XCTest
@testable import VibeWordCore

final class CompositeScopeTests: XCTestCase {
    func testIndependentRulesAndHierarchy() throws {
        let decks = [Deck(id: "a", name: "A"), Deck(id: "child", name: "Child", parentId: "a"), Deck(id: "b", name: "B")]
        func card(_ id: String, _ deck: String, _ tags: [String]) throws -> Card {
            try JSONDecoder().decode(Card.self, from: JSONSerialization.data(withJSONObject: ["id": id, "front": id, "back": id, "deckId": deck, "tags": tags]))
        }
        let cards = try [card("a-x", "a", ["x", "y"]), card("child-x", "child", ["x"]), card("b-y", "b", ["y"]), card("b-x", "b", ["x"])]
        let scope = StudyScope(rules: [StudyScopeRule(deckIds: ["a"], tags: ["x"]), StudyScopeRule(deckIds: ["b"], tags: ["y"])])
        XCTAssertEqual(cards.filter { scope.matches($0, decks: decks) }.map(\.id), ["a-x", "child-x", "b-y"])
        var overlap = scope; overlap.rules.append(StudyScopeRule(deckIds: ["child"], tags: nil))
        XCTAssertEqual(cards.filter { overlap.matches($0, decks: decks) }.count, 3)
        let encoded = try JSONEncoder().encode(scope)
        XCTAssertEqual(try JSONDecoder().decode(StudyScope.self, from: encoded), scope)
        let allTags = StudyScope(rules: [StudyScopeRule(deckIds: ["a"])])
        XCTAssertTrue(String(decoding: try JSONEncoder().encode(allTags), as: UTF8.self).contains("\"tags\":null"))
        XCTAssertFalse(StudyScope(rules: [StudyScopeRule(deckIds: [])]).isValid)
        XCTAssertFalse(StudyScope(rules: [StudyScopeRule(tags: [])]).isValid)
        XCTAssertFalse(StudyScope(rules: [StudyScopeRule(deckIds: ["deleted"])]).matches(cards[0], decks: decks))
    }
    func testLegacyAndUnknownVersionMigration() throws {
        let decoder = JSONDecoder()
        let legacy = try decoder.decode(StudyScope.self, from: Data(#"{"deckId":"a","tags":["x"]}"#.utf8))
        XCTAssertEqual(legacy.rules, [StudyScopeRule(deckIds: ["a"], tags: ["x"])])
        XCTAssertEqual(try decoder.decode(StudyScope.self, from: Data("null".utf8)).mode, "all")
        XCTAssertEqual(try decoder.decode(StudyScope.self, from: Data(#"["x"]"#.utf8)).tags, ["x"])
        XCTAssertFalse(try decoder.decode(StudyScope.self, from: Data(#"{"version":99}"#.utf8)).isValid)
    }
}
