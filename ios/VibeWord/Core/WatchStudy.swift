import Foundation

/// WatchConnectivity has its own allow-listed wire format: never encode Library
/// or arbitrary SyncEvent payloads (which can contain API credentials).
public struct WatchReview: Codable, Identifiable, Sendable {
    public var id: String
    public var timestamp: Double
    public var day: String
    public var progress: SchedulingState
    public var before: SchedulingState?
    public var quality: Int?
    public var schedulerConfig: SchedulerConfig?

    public init(progress: SchedulingState, day: String = Day.key(), timestamp: Double = Date().timeIntervalSince1970) {
        id = UUID().uuidString; self.progress = progress; self.day = day; self.timestamp = timestamp
    }
    public var event: SyncEvent {
        var event = SyncEvent(kind: .review, progress: progress)
        event.id = id; event.timestamp = timestamp; event.day = day
        event.before = before; event.quality = quality; event.algorithm = quality == nil ? nil : (progress.fsrs == nil ? "sm2-steps-v1" : FSRSScheduler.algorithm); event.schedulerConfig = schedulerConfig
        return event
    }
    public func validate() throws {
        guard UUID(uuidString: id) != nil, timestamp.isFinite, timestamp > 0,
              quality.map({ ReviewGrade(rawValue: $0) != nil && before?.cardId == progress.cardId }) ?? true,
              before.map(WatchSnapshot.valid) ?? true,
              WatchSnapshot.validDay(day), WatchSnapshot.valid(progress) else { throw WatchStudyError.invalidData }
    }
}

public struct ReviewStamp: Codable, Sendable {
    public var id: String
    public var timestamp: Double
    public func precedes(_ review: WatchReview) -> Bool {
        timestamp < review.timestamp || (timestamp == review.timestamp && id < review.id)
    }
}

public struct WatchSnapshot: Codable, Sendable {
    public var version = 3
    public var schedulerConfig: SchedulerConfig?
    public var sourceID: String
    public var deviceID: String
    public var revision: Int
    public var generatedAt: Date
    public var cards: [Card]
    public var progress: [String: SchedulingState]
    public var stamps: [String: ReviewStamp]
    public var reviewedByDay: [String: Int]
    public var acknowledgedIDs: [String]
    public var omittedCards: Int

    public init(events: [SyncEvent], sourceID: String, deviceID: String, revision: Int,
                acknowledgedIDs: [String] = [], now: Date = Date(), library cachedLibrary: Library? = nil) {
        let library = cachedLibrary ?? Library(events: events)
        self.schedulerConfig = library.schedulerConfig
        self.sourceID = sourceID; self.deviceID = deviceID; self.revision = revision; generatedAt = now
        let introduced = library.cards.filter { !StudyEngine.isNew(library.progress[$0.id]) && (library.controls[$0.id]?.available() ?? true) }.sorted {
            let a = library.progress[$0.id]!.due, b = library.progress[$1.id]!.due
            return a == b ? $0.id < $1.id : a < b
        }
        // Full text for up to 500 introduced cards. Images are excluded from the
        // watch projection; oversized cards stay on the phone, with a visible count.
        cards = []; var bytes = 0
        for var card in introduced {
            card.front = WatchText.plain(card.front); card.back = WatchText.plain(card.back)
            card.example = card.example.map(WatchText.plain)
            let size = card.front.utf8.count + card.back.utf8.count + (card.example?.utf8.count ?? 0)
            guard cards.count < 500, size <= 100_000, bytes + size <= 4_000_000 else { continue }
            cards.append(card); bytes += size
        }
        omittedCards = introduced.count - cards.count
        let ids = Set(cards.map(\.id))
        let histories = Dictionary(grouping: library.reviews, by: \.cardId)
        progress = library.progress.filter { ids.contains($0.key) }.mapValues { FSRSScheduler.migrate($0, history: histories[$0.cardId] ?? [], config: library.schedulerConfig) }
        stamps = [:]
        if let restore = events.filter({ $0.kind == .restore }).max(by: { $0.timestamp < $1.timestamp }) {
            for id in ids { stamps[id] = ReviewStamp(id: restore.id, timestamp: restore.timestamp) }
        }
        for event in events.sorted(by: { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }) {
            if event.kind == .review || event.kind == .reschedule, let state = event.progress, ids.contains(state.cardId), event.timestamp >= (stamps[state.cardId]?.timestamp ?? 0) {
                stamps[state.cardId] = ReviewStamp(id: event.id, timestamp: event.timestamp)
            }
        }
        reviewedByDay = library.stats.mapValues(\.reviewed)
        let saved = Set(events.filter { $0.kind == .review }.map(\.id))
        self.acknowledgedIDs = acknowledgedIDs.filter { saved.contains($0) }
    }

    public func validate() throws {
        try schedulerConfig?.validate()
        guard version == 3, revision > 0, !sourceID.isEmpty, !deviceID.isEmpty,
              cards.count <= 500, Set(cards.map(\.id)).count == cards.count,
              progress.count == cards.count, omittedCards >= 0,
              generatedAt.timeIntervalSince1970.isFinite,
              cards.allSatisfy({ !$0.id.isEmpty && progress[$0.id]?.cardId == $0.id }),
              progress.values.allSatisfy(Self.valid),
              stamps.values.allSatisfy({ $0.timestamp.isFinite }),
              reviewedByDay.allSatisfy({ Self.validDay($0.key) && $0.value >= 0 }) else {
            throw WatchStudyError.invalidData
        }
    }
    static func validDay(_ day: String) -> Bool {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard day.count == 10, parts.count == 3, (1...9999).contains(parts[0]),
              (1...12).contains(parts[1]), (1...31).contains(parts[2]),
              let date = Day.calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return false }
        return Day.key(date) == day
    }
    static func valid(_ state: SchedulingState) -> Bool {
        (state.fsrs.map { $0.version == 6 && $0.stability.isFinite && (0.001...36500).contains($0.stability) && $0.difficulty.isFinite && (1...10).contains($0.difficulty) } ?? true) && !state.cardId.isEmpty && state.ease.isFinite && state.ease >= 1.3 && state.ease <= 100
            && state.interval >= 0 && state.interval < 1_000_000 && state.repetitions >= 0
            && state.repetitions < 1_000_000 && validDay(state.due)
            && (state.lastReviewedAt?.isFinite ?? true) && (state.learningDue?.isFinite ?? true)
    }
}

public enum WatchStudyError: LocalizedError {
    case invalidData, differentPhone, wrongDevice, noSnapshot
    public var errorDescription: String? {
        switch self {
        case .invalidData: return "学习数据格式不兼容，请更新手机和手表应用后重试。"
        case .differentPhone: return "还有学习记录未传回原手机，请先连接原手机完成同步。"
        case .wrongDevice: return "收到旧设备的数据，正在等待当前手表的学习包。"
        case .noSnapshot: return "请先在 iPhone 上打开 Vibe Word，同步学习卡片。"
        }
    }
}

public enum WatchText {
    public static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: "!\\[[^\\]]*\\]\\([^\\n]*?\\)", with: "", options: .regularExpression)
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^\\n]*?\\)", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "(?m)^#{1,6}\\s+", with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public struct WatchRound: Codable, Sendable {
    public var queue: [String] = []
    public var total = 0
    public var done = 0
    public var relearned = 0
    public var removed = 0
    public var day = Day.key()
    public var flipped = false
    public var isStarted: Bool { total > 0 }
    public var isFinished: Bool { isStarted && queue.isEmpty }
}

/// One atomic document contains the baseline, durable outbox and resumable round.
/// Applying a snapshot and its acknowledgements is also one local transaction.
public struct WatchStudy: Codable, Sendable {
    public var version = 3
    public var deviceID = UUID().uuidString
    public var snapshot: WatchSnapshot?
    public var pending: [WatchReview] = []
    public var round = WatchRound()
    public init() {}

    public var progress: [String: SchedulingState] {
        var result = snapshot?.progress ?? [:]
        var stamps = snapshot?.stamps ?? [:]
        for review in pending.sorted(by: { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }) {
            let id = review.progress.cardId
            guard result[id] != nil else { continue } // Deleted/uncached cards cannot reappear.
            if stamps[id].map({ $0.precedes(review) }) ?? true {
                result[id] = review.progress
                stamps[id] = ReviewStamp(id: review.id, timestamp: review.timestamp)
            }
        }
        return result
    }
    public func due(on day: String = Day.key()) -> [Card] {
        let progress = progress
        return (snapshot?.cards ?? []).filter { card in
            let siblingReviewed = card.noteId.map { note in pending.contains { rating in
                rating.day == day && rating.progress.cardId != card.id && snapshot?.cards.first(where: { $0.id == rating.progress.cardId })?.noteId == note
            } } ?? false
            return !siblingReviewed && StudyEngine.isDue(progress[card.id], day: day)
        }
    }
    public func reviewed(on day: String = Day.key()) -> Int {
        (snapshot?.reviewedByDay[day] ?? 0) + pending.filter { $0.day == day }.count
    }
    public var current: Card? { current(at: Date()) }
    public func current(at now: Date) -> Card? {
        let next = round.queue.first { progress[$0]?.learningDue.map { $0 <= now.timeIntervalSince1970 * 1000 } ?? true }
        return snapshot?.cards.first { $0.id == next }
    }

    public mutating func apply(_ incoming: WatchSnapshot) throws {
        try incoming.validate()
        guard incoming.deviceID == deviceID else { throw WatchStudyError.wrongDevice }
        if let old = snapshot {
            if incoming.sourceID == old.sourceID {
                guard incoming.revision > old.revision else { return }
            } else {
                guard pending.isEmpty else { throw WatchStudyError.differentPhone }
                round = WatchRound()
            }
        }
        snapshot = incoming
        let confirmed = Set(incoming.acknowledgedIDs)
        pending.removeAll { confirmed.contains($0.id) }
        let ids = Set(incoming.cards.map(\.id))
        let before = round.queue.count
        let previousCard = round.queue.first
        round.queue.removeAll { !ids.contains($0) }
        round.removed += before - round.queue.count
        if previousCard != round.queue.first { round.flipped = false }
    }
    public mutating func start(on day: String = Day.key()) {
        guard round.queue.isEmpty else { return } // Resume, never consume another batch on activation.
        round = WatchRound(); round.day = day
        round.queue = Array(due(on: day).shuffled().prefix(5).map(\.id))
        round.total = round.queue.count
    }
    public mutating func review(_ grade: ReviewGrade, now: Date = Date()) throws {
        guard snapshot?.schedulerConfig != nil else { throw WatchStudyError.noSnapshot }
        guard let card = current(at: now), let prior = progress[card.id] else { throw WatchStudyError.noSnapshot }
        let day = Day.key(now)
        var review = WatchReview(progress: FSRSScheduler.preview(prior, config: snapshot?.schedulerConfig ?? SchedulerConfig(), now: now.timeIntervalSince1970 * 1000)[grade]!,
                                 day: day, timestamp: now.timeIntervalSince1970)
        review.before = prior; review.quality = grade.rawValue; review.schedulerConfig = snapshot?.schedulerConfig ?? SchedulerConfig()
        try review.validate()
        pending.append(review)
        round.flipped = false
        if review.progress.learningDue == nil { round.queue.removeAll { $0 == card.id }; round.done += 1 }
        if grade == .again { round.relearned += 1 }
        if let note = card.noteId {
            let siblings = Set((snapshot?.cards ?? []).filter { $0.id != card.id && $0.noteId == note }.map(\.id))
            let count = round.queue.count
            round.queue.removeAll { siblings.contains($0) }
            round.removed += count - round.queue.count
        }
    }
    public func validate() throws {
        guard version == 3, UUID(uuidString: deviceID) != nil,
              Set(pending.map(\.id)).count == pending.count,
              round.total >= 0, round.total <= 5, round.done >= 0,
              round.removed >= 0, round.relearned >= 0,
              round.queue.count + round.done + round.removed == round.total,
              Set(round.queue).count == round.queue.count,
              Set(round.queue).isSubset(of: Set(snapshot?.cards.map(\.id) ?? [])),
              snapshot == nil || snapshot?.deviceID == deviceID else { throw WatchStudyError.invalidData }
        try snapshot?.validate()
        for review in pending { try review.validate() }
    }
}

public struct WatchReviewBatch: Codable, Sendable {
    public var version = 3
    public var deviceID: String
    public var sourceID: String
    public var reviews: [WatchReview]
    public init(deviceID: String, sourceID: String, reviews: [WatchReview]) {
        self.deviceID = deviceID; self.sourceID = sourceID; self.reviews = reviews
    }
    public func validate() throws {
        guard version == 3, UUID(uuidString: deviceID) != nil, !sourceID.isEmpty, reviews.count <= 25,
              Set(reviews.map(\.id)).count == reviews.count else {
            throw WatchStudyError.invalidData
        }
        for review in reviews { try review.validate() }
    }
}
