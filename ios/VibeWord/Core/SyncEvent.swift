import Foundation

// Immutable records avoid whole-library overwrites and lost daily counters when
// devices work offline. UUID deduplication makes repeated imports idempotent.
public struct SyncEvent: Codable, Identifiable, Sendable {
    public var id: String = UUID().uuidString
    public var timestamp: Double = Date().timeIntervalSince1970
    public var kind: Kind
    public var day: String = Day.key()
    public var card: Card?
    public var cardId: String?
    public var progress: SchedulingState?
    public var config: APIConfig?
    public var limit: Int?
    public enum Kind: String, Codable, Sendable { case add, edit, delete, review, seed, issued, studyConfig, llmConfig, imageConfig }
    public init(kind: Kind, card: Card? = nil, cardId: String? = nil,
                progress: SchedulingState? = nil, config: APIConfig? = nil, limit: Int? = nil) {
        self.kind = kind; self.card = card; self.cardId = cardId
        self.progress = progress; self.config = config; self.limit = limit
    }
}

public struct DailyStat: Equatable {
    public var reviewed = 0
    public var added = 0
    public var total: Int { reviewed + added }
}

public struct Library {
    public var cards: [Card] = []
    public var progress: [String: SchedulingState] = [:]
    public var stats: [String: DailyStat] = [:]
    public var issued: [String: Set<String>] = [:]
    public var newCardsPerDay = 10
    public var llm = APIConfig()
    public var image = APIConfig()
    public init(events: [SyncEvent] = []) {
        var seen = Set<String>()
        var cards: [String: Card] = [:]
        // Deletion is permanent for a UUID, so a stale offline edit/review cannot resurrect it.
        let deleted = Set(events.filter { $0.kind == .delete }.compactMap(\.cardId))
        let ordered = events.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }
        for event in ordered where seen.insert(event.id).inserted {
            switch event.kind {
            case .add, .edit:
                if let card = event.card {
                    cards[card.id] = card
                    if event.kind == .add { stats[event.day, default: DailyStat()].added += 1 }
                }
            case .review:
                stats[event.day, default: DailyStat()].reviewed += 1
                if let state = event.progress { progress[state.cardId] = state }
            case .seed:
                if let state = event.progress, progress[state.cardId] == nil { progress[state.cardId] = state }
            case .issued:
                if let id = event.cardId { issued[event.day, default: []].insert(id) }
            case .studyConfig: if let limit = event.limit { newCardsPerDay = max(0, limit) }
            case .llmConfig: if let config = event.config { llm = config }
            case .imageConfig: if let config = event.config { image = config }
            case .delete: break
            }
        }
        self.cards = cards.values.filter { !deleted.contains($0.id) }.sorted {
            $0.createdAt == $1.createdAt ? $0.id < $1.id : ($0.createdAt ?? 0) > ($1.createdAt ?? 0)
        }
        progress = progress.filter { cards[$0.key] != nil && !deleted.contains($0.key) }
    }
}
