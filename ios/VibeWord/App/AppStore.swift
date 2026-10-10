import SwiftUI

@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var library = Library()
    @Published private(set) var libraryRevision = 0
    @Published var error: String?
    @Published var queue: [Card] = []
    @Published var done = 0
    @Published var relearned = 0
    @Published var total = 0
    @Published var sessionDeck: String?
    @Published var aheadDays = 0
    @Published private(set) var sessionScope = StudyScope()
    @Published private(set) var emptyStudyReason = "当前范围暂无待学卡片"
    @Published var lastReviewID: String?
    private var undoCard: Card?
    private var undoQueue: [Card] = []
    private var undoCounts = (0, 0)
    var availableStudyCards: [Card] {
        queue.filter { library.progress[$0.id]?.learningDue.map { $0 <= Date().timeIntervalSince1970 * 1000 } ?? true }
    }
    var currentStudyCard: Card? { availableStudyCards.first }
    var waitingUntil: Double? { queue.compactMap { library.progress[$0.id]?.learningDue }.min() }
    @Published private(set) var tasks: [AITask] = []
    @Published private(set) var aiError: String?
    private var aiReady = false
    private var aiWrites: Task<Void, Error>?
    private var aiConfirming = Set<String>()
    @Published private(set) var reading = LocalReadingState()
    @Published private(set) var saving = false
    private var pendingWrites = 0
    private var reviewing = false
    private var starting = false
    @Published private(set) var localStateLoaded = false
    private var restoringLocalState = false
    private var sessionDay = Day.key()
    let persistence: Persistence
    let watchSync: PhoneWatchSync
    private var workers: [String: Task<Void, Never>] = [:]
    init(persistence: Persistence) {
        self.persistence = persistence
        self.watchSync = PhoneWatchSync(persistence: persistence)
        persistence.onChange = { [weak self] in self?.reload() }
        if persistence.ready { reload() }
    }
    func reload() {
        guard persistence.snapshot.revision > libraryRevision || !localStateLoaded else { return }
        let previous = library
        library = persistence.snapshot.library
        libraryRevision = persistence.snapshot.revision
        if sessionDay != Day.key() { queue = []; sessionDay = Day.key() }
        if !saving {
            queue.removeAll { previous.progress[$0.id] != library.progress[$0.id] }
        }
        let current = Dictionary(uniqueKeysWithValues: library.cards.map { ($0.id, $0) })
        queue = queue.compactMap { card in guard let updated = current[card.id], library.inDeck(updated, sessionDeck), sessionScope.matches(updated), library.controls[card.id]?.available() ?? true else { return nil }; return updated }
        if !saving { persistSession() }
        watchSync.refresh()
        if !localStateLoaded { restoreLocalState() }
    }
    @discardableResult
    func save(_ events: [SyncEvent]) async -> Bool {
        pendingWrites += 1; saving = true
        defer { pendingWrites -= 1; saving = pendingWrites > 0 }
        do { try await persistence.append(events); return true }
        catch { self.error = "保存失败：\(error.localizedDescription)"; return false }
    }
    @discardableResult
    func add(_ cards: [Card]) async -> Bool {
        await save(cards.flatMap { card in
            [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: SchedulingState(cardId: card.id))]
        })
    }
    func saveEditedCard(expected: Card, draft: Card, fields: [String: String]? = nil) async throws {
        pendingWrites += 1; saving = true
        defer { pendingWrites -= 1; saving = pendingWrites > 0 }
        _ = try await persistence.commit { library in
            try library.cardEditorEvents(expected: expected, draft: draft, fields: fields)
        }
    }
    func replaceRegeneratedCard(expected: Card, draft: RegeneratedCard) async throws {
        pendingWrites += 1; saving = true
        defer { pendingWrites -= 1; saving = pendingWrites > 0 }
        _ = try await persistence.commit { library in
            [try library.replaceRegeneratedCardEvent(expected: expected, draft: draft)]
        }
    }
    func delete(_ cards: [Card]) async { _ = await save(cards.map { SyncEvent(kind: .delete, cardId: $0.id) }) }
    var schedule: Schedule {
        let selection = StudySelection.make(library: library, scope: library.studyScope)
        return Schedule(due: selection.reviews, fresh: selection.fresh)
    }
    @discardableResult
    func startSession(ahead: Int = 0, scope: StudyScope? = nil, deckId: String? = nil) async -> Bool {
        guard !starting else { return false }; starting = true; defer { starting = false }
        pendingWrites += 1; saving = true
        let chosen: StudyScope, selected: [Card], reason: String
        do {
            (chosen, selected, reason) = try await persistence.perform { storage in
                var chosen = StudyScope(), selected: [Card] = [], reason = ""
                let result = try storage.commit { library in
                    chosen = scope ?? (ahead > 0 ? StudyScope() : library.studyScope)
                    var scoped = library; scoped.cards = library.cards.filter { library.inDeck($0, deckId) }
                    let selection = StudySelection.make(library: scoped, scope: chosen)
                    reason = selection.emptyReason
                    if ahead > 0 {
                        selected = StudyEngine.ahead(cards: scoped.cards.filter(chosen.matches), progress: library.progress, controls: library.controls, days: ahead)
                        return []
                    }
                    let events = library.issueEvents(selection.fresh.map(\.id))
                    let issued = Set(events.compactMap(\.cardId))
                    selected = selection.reviews + selection.fresh.filter { issued.contains($0.id) }
                    return events
                }
                let cards = Dictionary(uniqueKeysWithValues: result.snapshot.library.cards.map { ($0.id, $0) })
                selected = selected.compactMap { cards[$0.id] }
                return (chosen, selected, reason)
            }
        } catch { pendingWrites -= 1; saving = pendingWrites > 0; self.error = error.localizedDescription; return false }
        pendingWrites -= 1; saving = pendingWrites > 0
        sessionDeck = deckId
        sessionDay = Day.key()
        aheadDays = ahead; sessionScope = chosen; lastReviewID = nil
        emptyStudyReason = reason
        queue = shuffleStudyCards(selected); total = queue.count; done = 0; relearned = 0
        persistSession()
        return true
    }
    func review(_ grade: ReviewGrade, cardId: String? = nil, context: ReviewContext? = nil) async -> Bool {
        guard !reviewing else { return false }; reviewing = true; defer { reviewing = false }
        error = nil
        guard let card = queue.first(where: { $0.id == (cardId ?? currentStudyCard?.id) }),
              library.controls[card.id]?.available() ?? true else { return false }
        let oldCounts = (done, relearned)
        let oldQueue = queue
        pendingWrites += 1; saving = true
        let event: SyncEvent
        do { event = try await persistence.review(card.id, grade: grade, context: context).events[0] }
        catch { pendingWrites -= 1; saving = pendingWrites > 0; self.error = error.localizedDescription; return false }
        pendingWrites -= 1; saving = pendingWrites > 0
        lastReviewID = event.id; undoCard = card; undoCounts = oldCounts; undoQueue = oldQueue
        if event.progress?.learningDue == nil { queue.removeAll { $0.id == card.id }; done += 1 }
        if grade == .again { relearned += 1 }
        persistSession()
        return true
    }
    func undoReview() async {
        guard !reviewing else { return }; reviewing = true; defer { reviewing = false }
        guard let id = lastReviewID, undoCard != nil else { return }
        do {
            pendingWrites += 1; saving = true
            defer { pendingWrites -= 1; saving = pendingWrites > 0 }
            _ = try await persistence.commit { [try $0.undoEvent(id)] }
            queue = undoQueue.filter { candidate in library.cards.contains(where: { $0.id == candidate.id }) && (library.controls[candidate.id]?.available() ?? true) }
            done = undoCounts.0; relearned = undoCounts.1; lastReviewID = nil
            persistSession()
        } catch { self.error = error.localizedDescription }
    }
    func control(_ card: Card, _ change: @escaping (inout CardControl) -> Void) async {
        do {
            _ = try await persistence.commit { library in
                guard library.cards.contains(where: { $0.id == card.id }) else { throw OpenFormat.failure("卡片已删除") }
                var control = library.controls[card.id] ?? CardControl(); change(&control)
                var event = SyncEvent(kind: .cardControl, cardId: card.id); event.control = control
                return [event]
            }
        } catch { self.error = error.localizedDescription }
        persistSession()
    }
    private func localURL(_ name: String) -> URL? { persistence.store?.directory.appendingPathComponent(name) }
    private func restoreLocalState() {
        guard !restoringLocalState, let directory = persistence.store?.directory else { return }
        restoringLocalState = true
        Task {
            let saved = try? await EventWorkers.run { () -> (LocalReadingState?, LocalStudySession?) in
                func read<T: Decodable>(_ name: String, _ type: T.Type) -> T? {
                    guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
                    return try? JSONDecoder().decode(type, from: data)
                }
                return (read("reading-state.json", LocalReadingState.self), read("study-session.json", LocalStudySession.self))
            }
            if let reading = saved?.0 { self.reading = reading }
            if let saved = saved?.1, queue.isEmpty {
                queue = saved.remaining(in: library)
                if !queue.isEmpty {
                    done = saved.done; total = max(saved.total, saved.done + queue.count)
                    relearned = saved.relearned; aheadDays = saved.aheadDays; sessionScope = saved.scope; sessionDeck = saved.deckID
                }
            }
            await loadAITasks()
            localStateLoaded = true
        }
    }
    private func writeLocal<T: Encodable & Sendable>(_ value: T, to url: URL) {
        EventWorkers.local.async {
            do { try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
            catch { let message = error.localizedDescription; Task { @MainActor in self.error = message } }
        }
    }
    func persistSession() {
        guard localStateLoaded, let url = localURL("study-session.json") else { return }
        let saved = LocalStudySession(day: sessionDay, ids: queue.map(\.id),
            progress: Dictionary(uniqueKeysWithValues: queue.compactMap { card in library.progress[card.id].map { (card.id, $0) } }),
            done: done, total: total, relearned: relearned, aheadDays: aheadDays, scope: sessionScope, deckID: sessionDeck)
        writeLocal(saved, to: url)
    }
    func rememberReading(cardID: String, ids: [String], block: Int, largeText: Bool) {
        reading.cardID = cardID; reading.ids = ids; reading.block = max(0, block); reading.largeText = largeText
        guard let url = localURL("reading-state.json") else { return }
        writeLocal(reading, to: url)
    }

    private var aiURL: URL? { persistence.store?.directory.appendingPathComponent("local-ai/ai-tasks.json") }
    func loadAITasks() async {
        guard let url = aiURL else { return }
        do {
            tasks = try await EventWorkers.run {
                #if DEBUG && targetEnvironment(simulator)
                if Persistence.isLocalPreview, !FileManager.default.fileExists(atPath: url.path),
                   let fixture = ProcessInfo.processInfo.environment["VIBE_TEST_AI_TASKS"] {
                    let file = try JSONDecoder().decode(AITaskFile.self, from: Data(fixture.utf8))
                    try file.save(to: url)
                }
                #endif
                return try AITaskFile.load(from: url)
            }
            aiReady = true; aiError = nil
        } catch { aiError = error.localizedDescription; aiReady = false }
    }
    private func mutateAI(_ action: @escaping (inout [AITask]) throws -> Void) async throws {
        guard aiReady, let url = aiURL else { throw OpenFormat.failure(aiError ?? "数据尚未就绪") }
        let previous = aiWrites
        let write = Task { @MainActor in
            _ = try? await previous?.value
            var next = self.tasks
            try action(&next)
            let file = AITaskFile(tasks: next)
            try await EventWorkers.run { try file.save(to: url) }
            self.tasks = next; self.aiError = nil
        }
        aiWrites = write
        try await write.value
    }
    func enqueue(_ word: String) async throws {
        guard library.llm.isConfigured else { throw OpenFormat.failure("请先在设置中配置 AI 模型") }
        guard !word.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw OpenFormat.failure("请先输入一个英文单词") }
        let task = AITask(word: word.trimmingCharacters(in: .whitespacesAndNewlines))
        try await mutateAI { $0.insert(task, at: 0) }; kick()
    }
    func enqueueReplacement(_ card: Card, requirements: String) async throws {
        guard card.anki == nil else { throw OpenFormat.failure("Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记") }
        let task = AITask(word: card.front, expected: card, requirements: requirements)
        try await mutateAI { $0.insert(task, at: 0) }; kick()
    }
    func enqueueDraft(taskID: String, draftID: String, requirements: String) async throws {
        guard let draft = tasks.first(where: { $0.id == taskID })?.drafts.first(where: { $0.id == draftID && $0.status == "ready" }) else { throw OpenFormat.failure("只能修改待审核卡片") }
        var task = AITask(word: draft.card.front, expected: draft.card, requirements: requirements)
        task.kind = "draft"; task.targetTaskID = taskID; task.targetDraftID = draftID; task.targetRevision = draft.revision
        let submitted = task
        try await mutateAI { $0.insert(submitted, at: 0) }; kick()
    }
    func pauseAITasks() async {
        aiSuspended = true
        for task in tasks where ["queued", "running"].contains(task.status) { try? await controlAI(task.id, status: "paused") }
    }
    func controlAI(_ id: String, status: String) async throws {
        if status == "queued", workers[id] != nil { throw OpenFormat.failure("请等待当前操作完成，或先停止生成") }
        if status != "queued" { workers[id]?.cancel() }
        try await mutateAI { tasks in
            guard let i = tasks.firstIndex(where: { $0.id == id }) else { return }
            tasks[i].status = status == "queued" && !tasks[i].drafts.isEmpty ? (tasks[i].readyCount > 0 ? "review" : "done") : status; tasks[i].error = nil
        }
        kick()
    }
    func clearFinishedAI() async throws {
        try await mutateAI { $0.removeAll { ["done", "cancelled"].contains($0.status) && $0.readyCount == 0 } }
    }
    func saveAIDraft(taskID: String, draft: AIDraft) async throws {
        try await mutateAI { tasks in
            guard let i = tasks.firstIndex(where: { $0.id == taskID }), let j = tasks[i].drafts.firstIndex(where: { $0.id == draft.id }), tasks[i].drafts[j].status == "ready", tasks[i].drafts[j].revision == draft.revision else { throw OpenFormat.failure("草稿内容已更新，请重新检查") }
            tasks[i].drafts[j].card = draft.card; tasks[i].drafts[j].revision += 1
        }
    }
    func discardAI(taskID: String, draftID: String) async throws {
        try await mutateAI { tasks in
            guard let i = tasks.firstIndex(where: { $0.id == taskID }), let j = tasks[i].drafts.firstIndex(where: { $0.id == draftID }), tasks[i].drafts[j].status == "ready" else { return }
            tasks[i].drafts[j].status = "discarded"; tasks[i].drafts[j].revision += 1
            if tasks[i].readyCount == 0 { tasks[i].status = "done" }
        }
    }
    func confirmAI(taskID: String, draftID: String) async throws {
        guard !aiConfirming.contains(draftID) else { return }
        aiConfirming.insert(draftID); defer { aiConfirming.remove(draftID) }
        // Serialize confirmation with draft edits and worker writes. The event
        // receipt survives a crash before the local draft is marked accepted.
        let previous = aiWrites
        let write = Task { @MainActor in
            _ = try? await previous?.value
            guard self.aiReady, let url = self.aiURL,
                  let i = self.tasks.firstIndex(where: { $0.id == taskID }), let draft = self.tasks[i].drafts.first(where: { $0.id == draftID && $0.status == "ready" }) else { return }
            let expected = self.tasks[i].kind == "replacement" ? self.tasks[i].expected : nil
            try await self.persistence.perform { store in
                let events = try AIConfirmation.events(existing: store.load(), draftID: draft.id, card: draft.card, expected: expected)
                _ = try store.append(events)
            }
            var next = self.tasks
            guard let j = next[i].drafts.firstIndex(where: { $0.id == draftID }) else { return }
            next[i].drafts[j].status = "accepted"
            if next[i].readyCount == 0 { next[i].status = "done" }
            let file = AITaskFile(tasks: next)
            try await EventWorkers.run { try file.save(to: url) }
            self.tasks = next
        }
        aiWrites = write; try await write.value
    }
    private var aiSuspended = false
    func setAIActive(_ active: Bool) { aiSuspended = !active }
    private var pendingAI: [String: [AIDraft]] = [:]
    private func kick() {
        guard !aiSuspended else { return }
        for task in tasks.reversed() where task.status == "queued" && workers[task.id] == nil {
            guard workers.count < 3 else { break }
            workers[task.id] = Task { [weak self] in await self?.runAI(task.id) }
        }
    }
    private func runAI(_ id: String) async {
        defer { workers[id] = nil; kick() }
        do {
            let config = library.llm, image = library.image
            guard config.isConfigured else { throw OpenFormat.failure("请先在设置中配置 AI 模型") }
            try Task.checkCancellation()
            try await mutateAI { tasks in
                if self.workers[id]?.isCancelled == true { throw CancellationError() }
                guard let i = tasks.firstIndex(where: { $0.id == id }) else { return }
                tasks[i].status = "running"; tasks[i].model = config.model; tasks[i].startedAt = Date().timeIntervalSince1970 * 1000
            }
            guard let task = tasks.first(where: { $0.id == id }) else { return }
            var drafts: [AIDraft]
            if let pending = pendingAI[id] { drafts = pending }
            else {
                let cards: [Card]
                if let expected = task.expected {
                    let result = try await GenerationService().regenerate(card: expected, requirements: task.requirements, config: config)
                    var card = expected; card.front = result.front; card.back = result.back; card.example = result.example
                    cards = [card]
                } else { cards = try await GenerationService().generate(word: task.word, config: config, image: image) }
                drafts = cards.enumerated().map { offset, card in
                    var card = card
                    let direction = task.expected == nil ? (offset == 0 ? "enToCn" : "cnToEn") : "replacement"
                    let draftID = id + ":" + direction
                    if task.expected == nil { card.id = "custom:ai:" + draftID; card.noteId = "note:ai:" + id }
                    return AIDraft(id: draftID, direction: direction, card: card)
                }
                pendingAI[id] = drafts
            }
            try Task.checkCancellation()
            let generated = drafts
            try await mutateAI { tasks in
                if self.workers[id]?.isCancelled == true { throw CancellationError() }
                guard let i = tasks.firstIndex(where: { $0.id == id }) else { return }
                if let targetTask = task.targetTaskID, let targetDraft = task.targetDraftID {
                    guard let t = tasks.firstIndex(where: { $0.id == targetTask }), let d = tasks[t].drafts.firstIndex(where: { $0.id == targetDraft }), tasks[t].drafts[d].status == "ready", tasks[t].drafts[d].revision == task.targetRevision else { throw OpenFormat.failure("草稿内容已更新，请重新检查") }
                    tasks[t].drafts[d].card = generated[0].card; tasks[t].drafts[d].revision += 1; tasks[i].status = "done"
                } else { tasks[i].drafts = generated; tasks[i].status = "review" }
                tasks[i].finishedAt = Date().timeIntervalSince1970 * 1000
                if image.isConfigured, task.expected == nil, !generated[0].card.back.contains("data:image/") { tasks[i].warning = "图片生成失败，请检查图片模型配置；文字草稿可审核。" }
            }
            pendingAI[id] = nil
        } catch {
            guard !Task.isCancelled else { return }
            let message = error.localizedDescription
            do { try await mutateAI { tasks in if let i = tasks.firstIndex(where: { $0.id == id }) { tasks[i].status = "failed"; tasks[i].error = message } } }
            catch { aiError = message; if let i = tasks.firstIndex(where: { $0.id == id }) { tasks[i].status = "failed"; tasks[i].error = message } }
        }
    }
}
