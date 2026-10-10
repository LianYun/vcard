import Foundation

public struct StudyScope: Codable, Sendable, Equatable {
    public var tags: [String]?
    public init(tags: [String]? = nil) {
        self.tags = tags.map { Array(Set($0.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })).sorted() }
    }
    public func matches(_ card: Card) -> Bool {
        guard let tags else { return true }
        let labels = (card.tags ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return tags.contains { $0.isEmpty ? labels.isEmpty : labels.contains($0) }
    }
    public var label: String {
        guard let tags else { return L("全部卡片") }
        return tags.isEmpty ? L("尚未选择标签") : tags.map { $0.isEmpty ? L("未打标签") : $0 }.joined(separator: "、")
    }
}

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
    public var restoredEvents: [SyncEvent]?
    public var before: SchedulingState?
    public var quality: Int?
    public var algorithm: String?
    public var schedulerConfig: SchedulerConfig?
    public var targetId: String?
    public var control: CardControl?
    public var config: APIConfig?
    public var studyScope: StudyScope?
    public var limit: Int?
    public var deck: Deck?
    public var deckIds: [String]?
    // Aggregated legacy desktop statistics; absent means one ordinary event.
    public var count: Int?
    public enum Kind: String, Codable, Sendable { case fsrsConfig, reschedule, deck, deleteDeck, add, edit, delete, review, seed, issued, studyConfig, llmConfig, imageConfig, undoReview, cardControl, restore }
    public init(kind: Kind, card: Card? = nil, cardId: String? = nil,
                progress: SchedulingState? = nil, config: APIConfig? = nil, limit: Int? = nil) {
        self.kind = kind; self.card = card; self.cardId = cardId
        self.progress = progress; self.config = config; self.limit = limit
    }
}

public struct DailyStat: Equatable, Sendable {
    public var reviewed = 0
    public var added = 0
    public var total: Int { reviewed + added }
}

public struct ReviewRecord: Codable, Sendable {
    public var id: String; public var cardId: String; public var timestamp: Double; public var day: String
    public var quality: Int; public var before: SchedulingState; public var after: SchedulingState
    public var algorithm: String; public var undone: Bool
}
public struct Library: Sendable {
    private var undoneIDs = Set<String>()
    public var decks: [Deck] = [Deck.defaultDeck]
    public var deckIssued: [String: [String: Set<String>]] = [:]
    public var cards: [Card] = []
    public var progress: [String: SchedulingState] = [:]
    public var stats: [String: DailyStat] = [:]
    public var issued: [String: Set<String>] = [:]
    public var controls: [String: CardControl] = [:]
    public var reviews: [ReviewRecord] = []
    public var reviewHeads: [String: String] = [:]
    public var schedulerConfig = SchedulerConfig()
    public var newCardsPerDay = 10
    public var studyScope = StudyScope()
    public var llm = APIConfig()
    public var image = APIConfig()
    public static func activeEvents(_ events: [SyncEvent]) -> [SyncEvent] {
        let ordered = events.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }
        guard let index = ordered.lastIndex(where: { $0.kind == .restore }) else { return ordered }
        return (ordered[index].restoredEvents ?? []) + ordered.suffix(from: index + 1)
    }
    public init(events: [SyncEvent] = []) {
        let events = Self.activeEvents(events)
        var seen = Set<String>()
        var cards: [String: Card] = [:]
        // Deletion is permanent for a UUID, so a stale offline edit/review cannot resurrect it.
        let deleted = Set(events.filter { $0.kind == .delete }.compactMap(\.cardId))
        let ordered = events.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }
        // An undo is valid only while its target is the latest review of that card.
        // Concurrent newer reviews remain authoritative rather than being overwritten.
        var heads: [String: String] = [:]
        var migratedCards = Set<String>()
        var undone = Set<String>()
        for event in ordered {
            if event.kind == .review || event.kind == .reschedule, let state = event.progress {
                if state.fsrs == nil && migratedCards.contains(state.cardId) { continue }
                if state.fsrs != nil { migratedCards.insert(state.cardId) }
                heads[state.cardId] = event.id
            }
            if event.kind == .undoReview, let id = event.cardId, let target = event.targetId, heads[id] == target {
                undone.insert(target)
            }
        }
        undoneIDs = undone
        for event in ordered where seen.insert(event.id).inserted {
            apply(event, cards: &cards, undone: undone)
        }
        for id in controls.keys {
            if let target = controls[id]?.buriedBy, undone.contains(target) {
                controls[id]?.buriedUntil = nil; controls[id]?.buriedBy = nil
            }
        }
        for index in decks.indices {
            if let parent = decks[index].parentId, !decks.contains(where: { $0.id == parent }) { decks[index].parentId = nil }
        }
        for index in decks.indices {
            var seen = Set<String>(), next: String? = decks[index].id
            while let id = next {
                if !seen.insert(id).inserted { decks[index].parentId = nil; break }
                next = decks.first { $0.id == id }?.parentId
            }
        }
        cards = cards.mapValues { card in var card = card; if !decks.contains(where: { $0.id == (card.deckId ?? "default") }) { card.deckId = "default" }; return card }
        self.cards = cards.values.filter { !deleted.contains($0.id) }.sorted {
            $0.createdAt == $1.createdAt ? $0.id < $1.id : ($0.createdAt ?? 0) > ($1.createdAt ?? 0)
        }
        progress = progress.filter { cards[$0.key] != nil && !deleted.contains($0.key) }
    }
    // Both full replay and ordered study commits use the same reducer.
    private mutating func apply(_ event: SyncEvent, cards: inout [String: Card], undone: Set<String>) {
        switch event.kind {
        case .fsrsConfig: if let config = event.schedulerConfig { schedulerConfig = config }
        case .reschedule: if let state = event.progress { progress[state.cardId] = state; reviewHeads[state.cardId] = event.id }
        case .deck:
            if let deck = event.deck { decks.removeAll { $0.id == deck.id }; decks.append(deck) }
        case .deleteDeck:
            if let id = event.targetId, id != "default" { decks.removeAll { $0.id == id } }
        case .add, .edit:
            if let card = event.card {
                cards[card.id] = card
            }
            if event.kind == .add { stats[event.day, default: DailyStat()].added += max(0, event.count ?? 1) }
        case .review:
            // A legacy offline client cannot replace a migrated memory state.
            if let state = event.progress, progress[state.cardId]?.fsrs != nil && state.fsrs == nil { break }
            if let before = event.before, let after = event.progress, let quality = event.quality {
                reviews.append(ReviewRecord(id: event.id, cardId: after.cardId, timestamp: event.timestamp * 1000,
                    day: event.day, quality: quality, before: before, after: after,
                    algorithm: event.algorithm ?? "legacy", undone: undone.contains(event.id)))
            }
            if undone.contains(event.id) { stats[event.day, default: DailyStat()].reviewed += 0; break }
            if let state = event.progress { reviewHeads[state.cardId] = event.id }
            stats[event.day, default: DailyStat()].reviewed += max(0, event.count ?? 1)
            if let state = event.progress { progress[state.cardId] = state }
        case .seed:
            if let state = event.progress, progress[state.cardId] == nil { progress[state.cardId] = state }
        case .issued:
            if let id = event.cardId {
                issued[event.day, default: []].insert(id)
                for deck in event.deckIds ?? ["default"] { deckIssued[event.day, default: [:]][deck, default: []].insert(id) }
                if progress[id] == nil { progress[id] = SchedulingState(cardId: id) }
                if progress[id]?.lastReviewedAt == nil { progress[id]?.issuedAt = event.day }
            }
        case .undoReview: break
        case .cardControl:
            if let id = event.cardId, var control = event.control {
                if let target = control.buriedBy, undone.contains(target) { control.buriedUntil = nil; control.buriedBy = nil }
                controls[id] = control
            }
        case .studyConfig:
            if let limit = event.limit { newCardsPerDay = max(0, limit) }
            if let scope = event.studyScope { studyScope = scope }
        case .llmConfig: if let config = event.config { llm = config }
        case .imageConfig: if let config = event.config { image = config }
        case .delete, .restore: break
        }
    }
    mutating func applyStudyEvents(_ events: [SyncEvent]) {
        var unchangedCards: [String: Card] = [:]
        for event in events { apply(event, cards: &unchangedCards, undone: undoneIDs) }
    }

}

public extension Library {
    func reviewEvent(cardId: String, grade: ReviewGrade, now: Double = Date().timeIntervalSince1970 * 1000) -> SyncEvent {
        let prior = FSRSScheduler.migrate(progress[cardId] ?? SchedulingState(cardId: cardId), history: reviews, config: schedulerConfig)
        var event = SyncEvent(kind: .review, progress: FSRSScheduler.preview(prior, config: schedulerConfig, now: now)[grade]!)
        event.before = prior; event.quality = grade.rawValue; event.algorithm = FSRSScheduler.algorithm; event.schedulerConfig = schedulerConfig
        event.timestamp = now / 1000; event.day = Day.key(Date(timeIntervalSince1970: now / 1000))
        return event
    }
    func undoEvent(_ target: String) throws -> SyncEvent {
        guard let review = reviews.first(where: { $0.id == target && !$0.undone }),
              reviewHeads[review.cardId] == target, cards.contains(where: { $0.id == review.cardId }) else {
            throw NSError(domain: "Study", code: 1, userInfo: [NSLocalizedDescriptionKey: "这张卡已有新的评分或已删除，无法撤销"])
        }
        var event = SyncEvent(kind: .undoReview, cardId: review.cardId)
        event.targetId = target
        return event
    }
    func siblingEvents(for card: Card, reviewID: String) -> [SyncEvent] {
        guard let note = card.noteId else { return [] }
        return cards.filter { $0.id != card.id && $0.noteId == note && (controls[$0.id]?.available() ?? true) }.map {
            var control = controls[$0.id] ?? CardControl()
            control.buriedUntil = Day.adding(1, to: Day.key()); control.buriedBy = reviewID
            var event = SyncEvent(kind: .cardControl, cardId: $0.id); event.control = control
            return event
        }
    }
}

public enum StudyFilter: String, CaseIterable {
    case all = "全部", due = "已到期", fresh = "新卡", marked = "标记卡", forgotten = "最近 7 天忘记", recent = "最近 7 天新增", suspended = "已暂停"
    public func matches(_ card: Card, library: Library, today: String = Day.key()) -> Bool {
        switch self {
        case .all: return true
        case .due: return (library.controls[card.id]?.available(on: today) ?? true) && StudyEngine.isDue(library.progress[card.id], day: today)
        case .fresh: return StudyEngine.isNew(library.progress[card.id])
        case .marked: return library.controls[card.id]?.marked == true
        case .suspended: return library.controls[card.id]?.suspended == true
        case .forgotten: return library.reviews.contains { $0.cardId == card.id && !$0.undone && $0.quality < 3 && $0.day >= Day.adding(-6, to: today) }
        case .recent: return card.createdAt.map { Day.key(Date(timeIntervalSince1970: $0)) >= Day.adding(-6, to: today) } ?? false
        }
    }
}

/// Read-only preview and actual session creation share this exact selection.
public struct StudySelection {
    public var matching: [Card]
    public var reviews: [Card]
    public var fresh: [Card]
    public var freshCount: Int
    public var budget: Int
    public var emptyReason: String {
        if matching.isEmpty { return "没有匹配卡片，请选择其他标签" }
        if reviews.isEmpty && freshCount > 0 && budget == 0 { return "今日新卡额度已用完" }
        return "当前范围暂无待学卡片"
    }
    public static func make(library: Library, scope: StudyScope, today: String = Day.key()) -> StudySelection {
        let matching = library.cards.filter(scope.matches)
        let cards = matching.filter { library.controls[$0.id]?.available(on: today) ?? true }
        let budget = max(0, library.newCardsPerDay - (library.issued[today]?.count ?? 0))
        var groups = Set<String>()
        let fresh = cards.filter { StudyEngine.isNew(library.progress[$0.id]) }.filter { card in
            card.noteId.map { groups.insert($0).inserted } ?? true
        }
        let reviews = cards.filter { card in
            !StudyEngine.isNew(library.progress[card.id]) &&
            (StudyEngine.isDue(library.progress[card.id], day: today) || library.progress[card.id]?.learningDue != nil)
        }
        return StudySelection(matching: matching, reviews: reviews, fresh: { let ids = Set(library.issueEvents(fresh.map(\.id), day: today).compactMap(\.cardId)); return fresh.filter { ids.contains($0.id) } }(), freshCount: fresh.count, budget: budget)
    }
}

extension Library {
    public func replaceRegeneratedCardEvent(expected: Card, draft: RegeneratedCard) throws -> SyncEvent {
        guard var current = cards.first(where: { $0.id == expected.id }) else { throw OpenFormat.failure("卡片已删除，请关闭后重新检查") }
        guard current.anki == nil, expected.anki == nil else { throw OpenFormat.failure("Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记") }
        guard current.front == expected.front, current.back == expected.back, (current.example ?? "") == (expected.example ?? "") else { throw OpenFormat.failure("卡片内容已更新，请关闭后重新生成") }
        guard !draft.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !draft.back.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw OpenFormat.failure("卡片正反面不能为空") }
        current.front = draft.front; current.back = draft.back; current.example = draft.example.isEmpty ? nil : draft.example
        return SyncEvent(kind: .edit, card: current)
    }
}

// Shared by the Mac bridge and iOS. The receipt is the formal add/edit event ID;
// the draft itself never enters the synchronized event stream.
public enum AIConfirmation {
    public static func events(existing: [SyncEvent], draftID: String, card: Card, expected: Card? = nil) throws -> [SyncEvent] {
        let receipt = "ai-confirm:\(draftID)"
        if existing.contains(where: { $0.id == receipt }) { return [] }
        guard !card.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !card.back.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, card.anki == nil else { throw OpenFormat.failure("卡片正反面不能为空") }
        let library = Library(events: existing)
        if let expected {
            guard let current = library.cards.first(where: { $0.id == expected.id }) else { throw OpenFormat.failure("卡片已删除，请关闭后重新检查") }
            guard current.deckId == expected.deckId, (current.tags ?? []) == (expected.tags ?? []) else { throw OpenFormat.failure("卡片内容已更新，请关闭后重新生成") }
            let content = RegeneratedCard(front: card.front, back: card.back, example: card.example ?? "")
            var event = try library.replaceRegeneratedCardEvent(expected: expected, draft: content)
            event.card?.tags = card.tags; event.card?.deckId = card.deckId
            event.id = receipt
            return [event]
        }
        // Old document drafts retain their original card IDs. Never recreate an
        // accepted card, even if it was subsequently edited or deleted.
        if existing.contains(where: { ($0.card?.id ?? $0.cardId) == card.id }) { return [] }
        var formal = card; formal.createdAt = Date().timeIntervalSince1970
        var add = SyncEvent(kind: .add, card: formal); add.id = receipt
        var seed = SyncEvent(kind: .seed, progress: SchedulingState(cardId: formal.id)); seed.id = receipt + ":seed"
        return [add, seed]
    }
}
