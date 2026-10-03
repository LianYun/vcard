import SwiftUI

@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var library = Library()
    @Published var error: String?
    @Published var queue: [Card] = []
    @Published var done = 0
    @Published var relearned = 0
    @Published var total = 0
    @Published var tasks: [GenerationTask] = []
    let persistence: Persistence
    private var workers: [UUID: Task<Void, Never>] = [:]

    struct GenerationTask: Identifiable {
        let id = UUID()
        let word: String
        let config: APIConfig
        var status = "排队中"
        var error: String?
        var cards: [Card] = []
        var finishedAt: Date?
    }
    init(persistence: Persistence) {
        self.persistence = persistence
        persistence.onChange = { [weak self] in self?.reload() }
    }
    func reload() {
        do {
            library = Library(events: try persistence.load())
            let current = Dictionary(uniqueKeysWithValues: library.cards.map { ($0.id, $0) })
            queue = queue.compactMap { current[$0.id] }
        } catch { self.error = "读取失败：\(error.localizedDescription)" }
    }
    @discardableResult
    func save(_ events: [SyncEvent]) -> Bool {
        do { try persistence.append(events); return true }
        catch { self.error = "保存失败：\(error.localizedDescription)"; return false }
    }
    @discardableResult
    func add(_ cards: [Card]) -> Bool {
        save(cards.flatMap { card in
            [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id))]
        })
    }
    func delete(_ cards: [Card]) { _ = save(cards.map { SyncEvent(kind: .delete, cardId: $0.id) }) }
    var schedule: Schedule {
        Schedule.make(cards: library.cards, progress: library.progress, limit: library.newCardsPerDay,
                      issued: library.issued[Day.key()]?.count ?? 0)
    }
    func startSession() {
        let result = schedule
        let events = result.fresh.flatMap { card in
            [SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id)), SyncEvent(kind: .issued, cardId: card.id)]
        }
        guard events.isEmpty || save(events) else { return }
        queue = (result.due + result.fresh).shuffled()
        total = queue.count; done = 0; relearned = 0
    }
    func review(_ grade: ReviewGrade) {
        guard let card = queue.first else { return }
        let prior = library.progress[card.id] ?? SchedulingState(cardId: card.id)
        guard save([SyncEvent(kind: .review, progress: SM2.grade(prior, quality: grade))]) else { return }
        queue.removeFirst()
        if grade == .again { queue.append(card); relearned += 1 } else { done += 1 }
    }
    func enqueue(_ word: String) {
        guard library.llm.isConfigured else { error = "请先在设置页配置 AI 模型 API"; return }
        pruneTasks()
        tasks.append(GenerationTask(word: word, config: library.llm))
        kick()
    }
    func cancel(_ id: UUID) {
        workers[id]?.cancel()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            tasks[index].status = "已取消"; tasks[index].finishedAt = Date()
        }
        kick()
    }
    func pruneTasks() {
        tasks.removeAll { $0.finishedAt.map { Date().timeIntervalSince($0) > 300 } ?? false }
    }
    private func kick() {
        while workers.count < 3, let index = tasks.firstIndex(where: { $0.status == "排队中" }) {
            tasks[index].status = "生成中"
            let job = tasks[index]
            let imageConfig = library.image
            workers[job.id] = Task { [weak self] in
                guard let self else { return }
                defer { self.workers[job.id] = nil; self.kick() }
                do {
                    let cards = try await GenerationService().generate(word: job.word, config: job.config, image: imageConfig)
                    try Task.checkCancellation()
                    guard self.add(cards) else { throw GenerationService.Failure("卡片保存失败，请重试") }
                    if let i = self.tasks.firstIndex(where: { $0.id == job.id }) {
                        self.tasks[i].cards = cards; self.tasks[i].status = "已完成"; self.tasks[i].finishedAt = Date()
                    }
                } catch {
                    if let i = self.tasks.firstIndex(where: { $0.id == job.id }) {
                        self.tasks[i].status = Task.isCancelled ? "已取消" : "失败"
                        self.tasks[i].error = Task.isCancelled ? nil : error.localizedDescription
                        self.tasks[i].finishedAt = Date()
                    }
                }
            }
        }
    }
}
