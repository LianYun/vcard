import Foundation

public struct AnkiNote: Codable, Equatable, Sendable {
    public var guid: String
    public var model: String
    public var fields: [String: String]
    public var question: String
    public var answer: String
    public var css: String
    public var ordinal: Int
    public var cloze: Bool
}
public struct Card: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var deckId: String?
    public var anki: AnkiNote?
    public var front: String
    public var back: String
    public var tags: [String]?
    public var noteId: String?
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
    public var phase: String?
    public var learningDue: Double?
    public var learningStep: Int?
    public var issuedAt: String?
    public var fsrs: MemoryState?
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
    public var supportsImages: Bool? = nil
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
        switch self { case .again: return L("重来"); case .hard: return L("困难"); case .good: return L("良好"); case .easy: return L("简单") }
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
        next.ease = max(1.3, previous.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
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
        let due = cards.filter { StudyEngine.isDue(progress[$0.id], day: today) }.shuffled()
        let fresh = cards.filter { StudyEngine.isNew(progress[$0.id]) }.shuffled().prefix(max(0, limit - issued))
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

public struct CardControl: Codable, Equatable, Sendable {
    public var suspended: Bool?; public var buriedUntil: String?; public var buriedBy: String?; public var marked: Bool?
    public init(suspended: Bool? = nil, buriedUntil: String? = nil, marked: Bool? = nil) {
        self.suspended = suspended; self.buriedUntil = buriedUntil; self.marked = marked
    }
    public func available(on day: String = Day.key()) -> Bool {
        suspended != true && (buriedUntil == nil || buriedUntil! <= day)
    }
}
public enum StudyEngine {
    public static func isNew(_ state: SchedulingState?) -> Bool {
        guard let state else { return true }
        return state.lastReviewedAt == nil && state.issuedAt == nil
    }
    public static func isDue(_ state: SchedulingState?, day: String = Day.key(), now: Double = Date().timeIntervalSince1970 * 1000) -> Bool {
        guard let state, !isNew(state) else { return false }
        return state.learningDue.map { $0 <= now } ?? (state.due <= day)
    }
    public static func grade(_ previous: SchedulingState, quality: ReviewGrade, now: Double = Date().timeIntervalSince1970 * 1000) -> SchedulingState {
        let day = Day.key(Date(timeIntervalSince1970: now / 1000))
        let learning = ["new", "learning", "relearning"].contains(previous.phase ?? "") || previous.lastReviewedAt == nil
        var next = previous
        if quality == .again || (learning && quality != .easy) {
            if quality.rawValue >= 4 && (previous.learningStep ?? 0) >= 1 {
                next = SM2.grade(previous, quality: quality, on: day, at: now)
                next.phase = "review"; next.learningDue = nil; next.learningStep = 0
                return next
            }
            if quality == .again && !learning { next = SM2.grade(previous, quality: quality, on: day, at: now) }
            let minutes = quality == .again ? 1 : quality == .hard ? 6 : 10
            next.phase = previous.phase == "relearning" || !learning ? "relearning" : "learning"
            next.learningStep = quality == .again ? 0 : quality == .hard ? previous.learningStep ?? 0 : 1
            next.learningDue = now + Double(minutes * 60000)
            next.due = Day.key(Date(timeIntervalSince1970: next.learningDue! / 1000))
            next.lastReviewedAt = now
            return next
        }
        next = SM2.grade(previous, quality: quality, on: day, at: now)
        next.phase = "review"; next.learningDue = nil; next.learningStep = 0
        return next
    }
    public static func label(_ state: SchedulingState, now: Double = Date().timeIntervalSince1970 * 1000) -> String {
        if let due = state.learningDue { let minutes = max(0.1, ((due - now) / 6000).rounded() / 10); return L("{0} 分钟", minutes == minutes.rounded() ? String(Int(minutes)) : String(format: "%.1f", minutes)) }
        return L("{0} 天", "\(state.interval)")
    }
    public static func ahead(cards: [Card], progress: [String: SchedulingState], controls: [String: CardControl], days: Int, today: String = Day.key()) -> [Card] {
        guard (1...5).contains(days) else { return [] }
        return cards.filter { card in
            guard let state = progress[card.id] else { return false }
            return (controls[card.id]?.available(on: today) ?? true) && state.lastReviewedAt != nil && state.learningDue == nil && state.due > today && state.due <= Day.adding(days, to: today)
        }.sorted { progress[$0.id]!.due == progress[$1.id]!.due ? $0.id < $1.id : progress[$0.id]!.due < progress[$1.id]!.due }
    }
}


public struct RegeneratedCard: Codable, Equatable, Sendable {
    public var front: String
    public var back: String
    public var example: String
    public init(front: String, back: String, example: String = "") { self.front = front; self.back = back; self.example = example }
}
