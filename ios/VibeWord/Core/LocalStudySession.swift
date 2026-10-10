import Foundation

/// Randomize only at session creation; resumed sessions retain their saved order.
public func shuffleStudyCards(_ cards: [Card]) -> [Card] {
    let shuffled = cards.shuffled()
    guard zip(shuffled, shuffled.dropFirst()).contains(where: { first, second in
        first.noteId != nil && first.noteId == second.noteId
    }) else { return shuffled }
    var groups: [[Card]] = []
    var positions: [String: Int] = [:]
    for card in shuffled {
        let key = card.noteId.map { "note:\($0)" } ?? "card:\(card.id)"
        if let index = positions[key] { groups[index].append(card) }
        else { positions[key] = groups.count; groups.append([card]) }
    }
    // Explicit tie-break preserves the randomized group order across platforms.
    let ordered = groups.enumerated().sorted {
        $0.element.count == $1.element.count ? $0.offset < $1.offset : $0.element.count > $1.element.count
    }
    var result = shuffled
    var index = 0
    for group in ordered {
        for card in group.element {
            if index >= result.count { index = 1 }
            result[index] = card
            index += 2
        }
    }
    return result
}

/// Device-local continuation state. Never exported as a sync event.
public struct LocalStudySession: Codable, Sendable {
    public var day: String
    public var ids: [String]
    public var progress: [String: SchedulingState]
    public var done: Int
    public var total: Int
    public var relearned: Int
    public var aheadDays: Int
    public var scope: StudyScope
    public var deckID: String? = nil

    public func remaining(in library: Library, today: String = Day.key()) -> [Card] {
        guard day == today else { return [] }
        let cards = Dictionary(uniqueKeysWithValues: library.cards.map { ($0.id, $0) })
        return ids.compactMap { id in
            guard let card = cards[id], library.controls[id]?.available(on: today) ?? true,
                  library.progress[id] == progress[id] else { return nil }
            return card
        }
    }
}

public struct LocalReadingState: Codable, Sendable, Equatable {
    public var cardID: String?
    public var ids: [String] = []
    public var block: Int = 0
    public var largeText = false
    public init() {}
}
