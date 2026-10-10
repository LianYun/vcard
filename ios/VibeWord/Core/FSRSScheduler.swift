import Foundation

public struct MemoryState: Codable, Equatable, Sendable {
    public var version = 6
    public var stability: Double
    public var difficulty: Double
    public var lapses: Int
    public var source: String
    public var parametersId: String
}
public struct SchedulerConfig: Codable, Equatable, Sendable {
    public var version = 6
    public var id = "fsrs6-default-v1"
    public var retention = 0.9
    public var maximumInterval = 36500
    public var learningSteps: [Double] = [1, 10]
    public var relearningSteps: [Double] = [10]
    public var weights = [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]
    public var optimizedAt: Double?
    public init() {}
    public func validate() throws {
        guard version == 6, !id.isEmpty, retention.isFinite, (0.7...0.97).contains(retention),
              (1...36500).contains(maximumInterval), weights.count == 21,
              weights.enumerated().allSatisfy({ $0.element.isFinite && $0.element > 0 && $0.element <= ($0.offset == 7 ? 1 : 100) }),
              weights[20] <= 1, weights[15] <= 1, weights[16] >= 1,
              [learningSteps, relearningSteps].allSatisfy({ steps in
                  !steps.isEmpty && steps.count <= 4 && steps.enumerated().allSatisfy { i, m in
                      m.isFinite && m >= 0.1 && m < 1440 && (i == 0 || m > steps[i-1])
                  }
              }) else { throw OpenFormat.failure("复习算法配置无效") }
    }
}
public struct ReviewContext: Codable, Sendable {
    public var now: Double
    public var configId: String
    public var before: SchedulingState
    public init(now: Double, configId: String, before: SchedulingState) { self.now = now; self.configId = configId; self.before = before }
}
public enum FSRSScheduler {
    public static let algorithm = "fsrs-6-anki-v1"
    static func engine(_ c: SchedulerConfig) -> FSRSAlgorithm {
        FSRSAlgorithm(parameters: FSRSParameters(requestRetention: c.retention, maximumInterval: Double(c.maximumInterval), w: c.weights, enableFuzz: false, enableShortTerm: true))
    }
    static func rating(_ q: Int) -> Rating { Rating(rawValue: q < 3 ? 1 : q - 1)! }
    public static func elapsed(_ previous: Double?, _ now: Double) -> Double {
        guard let previous else { return 0 }
        let start = Day.calendar.startOfDay(for: Date(timeIntervalSince1970: previous / 1000))
        let end = Day.calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1000))
        return Double(max(0, Day.calendar.dateComponents([.day], from: start, to: end).day ?? 0))
    }
    static func estimate(_ s: SchedulingState, _ c: SchedulerConfig) -> MemoryState? {
        guard s.lastReviewedAt != nil else { return nil }
        let stability = max(0.1, min(36500, Double(s.interval))), w = c.weights
        let difficulty = max(1, min(10, 11 - (s.ease - 1) / (exp(w[8]) * pow(stability, -w[9]) * (exp(0.1 * w[10]) - 1))))
        return MemoryState(stability: stability, difficulty: difficulty, lapses: 0, source: "estimated", parametersId: c.id)
    }
    public static func migrate(_ state: SchedulingState, history: [ReviewRecord] = [], config c: SchedulerConfig = SchedulerConfig()) -> SchedulingState {
        if state.fsrs?.version == 6 && state.fsrs?.parametersId == c.id { return state }
        var state = state
        let records = history.filter { $0.cardId == state.cardId && !$0.undone && $0.timestamp <= (state.lastReviewedAt ?? 0) }.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }
        guard let first = records.first, records.last?.timestamp == state.lastReviewedAt else {
            state.fsrs = state.fsrs ?? estimate(state, c); state.fsrs?.parametersId = c.id; return state
        }
        let e = engine(c)
        var memory = estimate(first.before, c).map { FSRSState(stability: $0.stability, difficulty: $0.difficulty) }
        var previous = first.before.lastReviewedAt, lapses = 0
        for r in records {
            if r.before.lastReviewedAt != previous { memory = estimate(r.before, c).map { FSRSState(stability: $0.stability, difficulty: $0.difficulty) }; previous = r.before.lastReviewedAt }
            memory = try! e.nextState(memoryState: memory, t: elapsed(previous, r.timestamp), g: rating(r.quality))
            if r.quality < 3 && r.before.phase == "review" { lapses += 1 }
            previous = r.timestamp
        }
        state.fsrs = MemoryState(stability: memory!.stability, difficulty: memory!.difficulty, lapses: lapses, source: first.before.lastReviewedAt == nil ? "history" : "partial", parametersId: c.id)
        return state
    }
    public static func preview(_ input: SchedulingState, config c: SchedulerConfig = SchedulerConfig(), now: Double = Date().timeIntervalSince1970 * 1000) -> [ReviewGrade: SchedulingState] {
        let before = migrate(input, config: c), e = engine(c), t = elapsed(before.lastReviewedAt, now)
        let day = Day.key(Date(timeIntervalSince1970: now / 1000))
        let phase = before.phase ?? (before.lastReviewedAt == nil ? "new" : "review")
        var result: [ReviewGrade: SchedulingState] = [:], lastInterval = 0
        for grade in ReviewGrade.allCases {
            let q = grade.rawValue
            let m = try! e.nextState(memoryState: before.fsrs.map { FSRSState(stability: $0.stability, difficulty: $0.difficulty) }, t: t, g: rating(q))
            var interval = e.nextInterval(s: m.stability, elapsedDays: t, seed: nil)
            if phase == "review" && q >= 3 { interval = min(c.maximumInterval, max(interval, lastInterval + 1)); lastInterval = interval }
            var nextPhase = "review", step = 0
            var minutes: Double?
            let relearning = phase == "relearning" || (phase == "review" && q < 3)
            let steps = relearning ? c.relearningSteps : c.learningSteps
            let index = min(before.learningStep ?? 0, steps.count - 1)
            if phase != "review" || q < 3 {
                if q < 3 { minutes = steps[0]; step = 0 }
                else if q == 3 { step = index; minutes = index == 0 ? (steps.count > 1 ? (steps[0] + steps[1]) / 2 : steps[0] * 1.5) : steps[index] }
                else if q == 4 && index + 1 < steps.count { step = index + 1; minutes = steps[step] }
                if minutes != nil { nextPhase = relearning ? "relearning" : "learning" }
            }
            var next = before
            next.fsrs = MemoryState(stability: m.stability, difficulty: m.difficulty, lapses: (before.fsrs?.lapses ?? 0) + (q < 3 && phase == "review" ? 1 : 0), source: before.fsrs?.source ?? "new", parametersId: c.id)
            next.phase = nextPhase; next.learningStep = step
            next.learningDue = minutes.map { now + ($0 * 60000).rounded() }
            next.interval = interval; next.repetitions = q < 3 ? 0 : before.repetitions + 1
            next.due = next.learningDue.map { Day.key(Date(timeIntervalSince1970: $0 / 1000)) } ?? Day.adding(interval, to: day)
            next.lastReviewedAt = now
            result[grade] = next
        }
        return result
    }
    public static func retrievability(_ state: SchedulingState, config c: SchedulerConfig, now: Double = Date().timeIntervalSince1970 * 1000) -> Double? {
        guard let m = state.fsrs ?? estimate(state, c) else { return nil }
        return engine(c).forgettingCurve(elapsedDays: max(0, (now - (state.lastReviewedAt ?? now)) / 86400000), stability: m.stability)
    }
    public static func projection(_ states: [SchedulingState], history: [ReviewRecord], config c: SchedulerConfig, now: Double = Date().timeIntervalSince1970 * 1000) -> [SchedulingState] {
        let day = Day.key(Date(timeIntervalSince1970: now / 1000)), e = engine(c)
        let histories = Dictionary(grouping: history, by: \.cardId)
        return states.filter { $0.lastReviewedAt != nil && $0.learningDue == nil }.map { state in
            var s = migrate(state, history: histories[state.cardId] ?? [], config: c)
            s.interval = e.nextInterval(s: s.fsrs!.stability, elapsedDays: 0, seed: nil)
            s.due = max(day, Day.adding(s.interval, to: Day.key(Date(timeIntervalSince1970: s.lastReviewedAt! / 1000))))
            return s
        }
    }
}

public struct OptimizationResult: Codable, Sendable {
    public var config: SchedulerConfig
    public var samples: Int; public var training: Int; public var validation: Int
    public var baselineLoss: Double; public var candidateLoss: Double; public var accepted: Bool
}
public extension FSRSScheduler {
    static func optimize(_ history: [ReviewRecord], config: SchedulerConfig) throws -> OptimizationResult {
        try config.validate()
        let records = Array(history.filter { !$0.undone && [1,3,4,5].contains($0.quality) }.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }.suffix(10000))
        let eligible = records.filter { $0.before.lastReviewedAt != nil && elapsed($0.before.lastReviewedAt, $0.timestamp) > 0 }
        guard eligible.count >= 200, eligible.filter({ $0.quality < 3 }).count >= 20, eligible.filter({ $0.quality >= 3 }).count >= 20 else {
            throw OpenFormat.failure("需要至少 200 次跨日复习，其中至少 20 次遗忘和 20 次记住")
        }
        let cutoff = eligible[Int(Double(eligible.count) * 0.8)].timestamp
        let holdout = eligible.filter { $0.timestamp >= cutoff }
        guard holdout.filter({ $0.quality < 3 }).count >= 5, holdout.filter({ $0.quality >= 3 }).count >= 5, eligible.filter({ $0.timestamp < cutoff }).count >= 100 else { throw OpenFormat.failure("验证记录不足，请积累更多不同日期的复习后再优化") }
        func loss(_ weights: [Double], validation: Bool) -> Double {
            var c = config; c.weights = weights
            let e = engine(c)
            var states: [String: (FSRSState, Double)] = [:], sum = 0.0, count = 0
            for r in records {
                let prior = states[r.cardId]
                let memory = prior?.1 == r.before.lastReviewedAt ? prior?.0 : estimate(r.before, c).map { FSRSState(stability: $0.stability, difficulty: $0.difficulty) }
                let t = elapsed(r.before.lastReviewedAt, r.timestamp)
                if let memory, t > 0, (r.timestamp >= cutoff) == validation {
                    let p = max(0.00001, min(0.99999, e.forgettingCurve(elapsedDays: t, stability: memory.stability)))
                    sum -= r.quality < 3 ? log(1 - p) : log(p); count += 1
                }
                states[r.cardId] = (try! e.nextState(memoryState: memory, t: t, g: rating(r.quality)), r.timestamp)
            }
            return count > 0 ? sum / Double(count) : .infinity
        }
        var weights = config.weights, score = loss(config.weights, validation: false)
        for pass in 0..<3 {
            try Task.checkCancellation()
            for i in [0,1,2,3,8,9,10,11,12,13,14,15,16,17,18,19,20] {
                let base = weights[i]
                for direction in [-1.0, 1.0] {
                    var candidate = weights
                    candidate[i] = max(0.001, min(i == 15 || i == 20 ? 1 : 100, base * exp(direction * 0.15 / Double(pass + 1))))
                    if i == 16 { candidate[i] = max(1, candidate[i]) }
                    let penalty = candidate.enumerated().reduce(0.0) { $0 + pow(log($1.element / config.weights[$1.offset]), 2) } * 0.001
                    let next = loss(candidate, validation: false) + penalty
                    if next < score { weights = candidate; score = next }
                }
            }
        }
        let baselineLoss = loss(config.weights, validation: true), candidateLoss = loss(weights, validation: true)
        let accepted = candidateLoss.isFinite && candidateLoss < baselineLoss - 0.001
        var updated = config
        if accepted { updated.weights = weights; updated.id = UUID().uuidString; updated.optimizedAt = Date().timeIntervalSince1970 * 1000 }
        return OptimizationResult(config: updated, samples: eligible.count, training: eligible.filter { $0.timestamp < cutoff }.count, validation: eligible.filter { $0.timestamp >= cutoff }.count, baselineLoss: baselineLoss, candidateLoss: candidateLoss, accepted: accepted)
    }
}
public extension Library {
    func preparedState(_ id: String) -> SchedulingState {
        FSRSScheduler.migrate(progress[id] ?? SchedulingState(cardId: id), history: reviews, config: schedulerConfig)
    }
    func validateReviewContext(_ context: ReviewContext?, cardID: String) throws -> Double {
        let now = Date().timeIntervalSince1970 * 1000
        guard let context else { return now }
        guard context.configId == schedulerConfig.id, context.before == preparedState(cardID),
              context.now.isFinite, context.now <= now + 60000, context.now >= now - 120000 else {
            throw OpenFormat.failure("学习状态已变化，请重新检查")
        }
        return context.now
    }
}
