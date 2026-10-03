import Foundation

public struct Card: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var front: String
    public var back: String
    public var example: String?
    public var createdAt: Double?
    public init(id: String = "custom:\(UUID().uuidString)", front: String, back: String,
                example: String? = nil, createdAt: Double? = Date().timeIntervalSince1970) {
        self.id = id; self.front = front; self.back = back
        self.example = example; self.createdAt = createdAt
    }
}

public struct SchedulingState: Codable, Equatable, Sendable {
    public var cardId: String
    public var ease: Double = 2.5
    public var interval: Int = 0
    public var repetitions: Int = 0
    public var due: String
    public var lastReviewedAt: Double? // milliseconds, matching TypeScript
    public init(cardId: String, due: String = Day.key()) { self.cardId = cardId; self.due = due }
}

public struct APIConfig: Codable, Equatable, Sendable {
    public var baseURL = ""
    public var apiKey = ""
    public var model = ""
    public init() {}
    public var isConfigured: Bool { !baseURL.isEmpty && !apiKey.isEmpty && !model.isEmpty }
    public func trimmed() -> APIConfig {
        var value = self
        value.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        value.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        value.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        return value
    }
}

public enum Day {
    public static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }
    public static func key(_ date: Date = Date()) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    public static func adding(_ days: Int, to key: String) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        precondition(parts.count == 3)
        let calendar = Self.calendar
        let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))!
        return Self.key(calendar.date(byAdding: .day, value: days, to: date)!)
    }
}

public enum ReviewGrade: Int, CaseIterable, Sendable {
    case again = 1, hard = 3, good = 4, easy = 5
    public var title: String {
        switch self { case .again: return "重来"; case .hard: return "困难"; case .good: return "良好"; case .easy: return "简单" }
    }
    public var shortcut: Character {
        switch self { case .again: return "a"; case .hard: return "s"; case .good: return "d"; case .easy: return "e" }
    }
}

public enum SM2 {
    public static func grade(_ previous: SchedulingState, quality: ReviewGrade,
                             on day: String = Day.key(), at timestamp: Double = Date().timeIntervalSince1970 * 1000) -> SchedulingState {
        var next = previous
        let q = Double(quality.rawValue)
        next.repetitions = q < 3 ? 0 : previous.repetitions + 1
        if q < 3 || next.repetitions == 1 { next.interval = 1 }
        else if next.repetitions == 2 { next.interval = 6 }
        else { next.interval = max(1, Int((Double(previous.interval) * previous.ease).rounded())) }
        next.ease = max(1.3, previous.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        next.due = Day.adding(next.interval, to: day)
        next.lastReviewedAt = timestamp
        return next
    }
}

public struct Schedule {
    public var due: [Card]
    public var fresh: [Card]
    public static func make(cards: [Card], progress: [String: SchedulingState], limit: Int,
                            issued: Int, today: String = Day.key()) -> Schedule {
        let due = cards.filter { progress[$0.id].map { $0.due <= today } ?? false }.shuffled()
        let fresh = cards.filter { progress[$0.id] == nil }.shuffled().prefix(max(0, limit - issued))
        return Schedule(due: due, fresh: Array(fresh))
    }
}

public enum Obsidian {
    static func flatten(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\n\\s*\n+", with: "  \n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    public static func markdown(_ cards: [Card]) -> String {
        var lines = ["#flashcards", ""]
        for card in cards {
            var back = flatten(card.back)
            if let example = card.example, !example.isEmpty { back += "  \n*\(flatten(example))*" }
            lines += [flatten(card.front), "?", back, ""]
        }
        return lines.joined(separator: "\n")
    }
}
