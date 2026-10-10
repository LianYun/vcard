import Foundation
import SwiftUI
import WidgetKit

@MainActor
final class WatchStore: ObservableObject {
    @Published private(set) var study = WatchStudy()
    @Published private(set) var ready = false
    @Published private(set) var today = Day.key()
    @Published var error: String?
    @Published var widgetWarning: String?
    let link = WatchLink()
    private let url: URL
    let demo: Bool

    init() {
        #if DEBUG && targetEnvironment(simulator)
        demo = ProcessInfo.processInfo.arguments.contains("-watch-demo")
        #else
        demo = false
        #endif
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var name = demo ? "watch-demo.json" : "watch-study.json"
        #if DEBUG && targetEnvironment(simulator)
        if demo, let raw = ProcessInfo.processInfo.environment["VIBE_WATCH_TEST_STORE"], let id = UUID(uuidString: raw) {
            name = "watch-test-\(id.uuidString).json"
        }
        #endif
        url = directory.appendingPathComponent(name)
        link.onData = { [weak self] kind, data in
            guard kind == "snapshot", let self, self.ready else { return }
            do {
                guard data.count <= 8_000_000 else { throw WatchStudyError.invalidData }
                let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: data)
                if self.commit({ try $0.apply(snapshot) }) { self.flush() }
            } catch { self.error = error.localizedDescription }
        }
        link.onReady = { [weak self] in self?.synchronize() }
        load()
        if !demo { link.activate() }
    }
    func load() {
        do {
            if FileManager.default.fileExists(atPath: url.path) {
                var value = try JSONDecoder().decode(WatchStudy.self, from: Data(contentsOf: url))
                if value.version < 3 { value.version = 3; value.snapshot?.version = 3; value.snapshot?.schedulerConfig = nil; try value.validate(); try persist(value) }
                try value.validate(); study = value
            } else {
                var value = WatchStudy()
                if demo {
                    let pairs = [("serendipity", "不期而遇的美好", "A moment of serendipity."),
                                 ("resilience", "韧性；恢复力", "She showed great resilience."),
                                 ("tranquility", "宁静；安宁", "Enjoy a moment of tranquility."),
                                 ("curiosity", "好奇心", "Let curiosity lead the way."),
                                 ("gratitude", "感激；感谢", "A small gesture of gratitude.")]
                    let events = pairs.flatMap { word, meaning, example -> [SyncEvent] in
                        let card = Card(front: word, back: meaning + "\n\n这张示例卡用于本地交互测试。", example: example)
                        var progress = SchedulingState(cardId: card.id); progress.lastReviewedAt = Date().timeIntervalSince1970 * 1000 - 86400000; progress.phase = "review"
                        return [SyncEvent(kind: .add, card: card), SyncEvent(kind: .seed, progress: progress)]
                    }
                    try value.apply(WatchSnapshot(events: events, sourceID: "demo", deviceID: value.deviceID, revision: 1))
                }
                try persist(value); study = value
            }
            ready = true; error = nil; updateWidget()
        } catch {
            // Never overwrite unreadable data with an empty document/outbox.
            ready = false; self.error = "本地数据未能打开：\(error.localizedDescription)"
        }
    }
    private func persist(_ value: WatchStudy) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    @discardableResult
    private func commit(_ mutation: (inout WatchStudy) throws -> Void) -> Bool {
        guard ready else { return false }
        do {
            var next = study
            try mutation(&next)
            try persist(next)
            study = next; updateWidget()
            return true
        } catch { self.error = "尚未保存：\(error.localizedDescription)"; return false }
    }
    func start() { _ = commit { $0.start() } }
    func flip() { _ = commit { $0.round.flipped.toggle() } }
    @discardableResult
    func review(_ grade: ReviewGrade, at now: Date = Date()) -> Bool {
        guard commit({ try $0.review(grade, now: now) }) else { return false }
        flush(); return true
    }
    func activate() {
        refreshDay()
        synchronize()
    }
    func tick() {
        refreshDay()
        if study.snapshot == nil || !study.pending.isEmpty { synchronize() }
    }
    private func refreshDay() {
        let day = Day.key()
        if today != day { today = day; updateWidget() }
    }
    func synchronize() {
        guard ready, !demo, link.activated else { return }
        let request = WatchRequest(deviceID: study.deviceID, pendingIDs: Array(study.pending.prefix(25).map(\.id)))
        if let data = try? JSONEncoder().encode(request) {
            link.send("request", data: data, key: "request-\(study.deviceID)-\(study.snapshot?.revision ?? 0)")
        }
        flush()
    }
    private func flush() {
        guard !demo, let source = study.snapshot?.sourceID, !study.pending.isEmpty else { return }
        let batch = WatchReviewBatch(deviceID: study.deviceID, sourceID: source, reviews: Array(study.pending.prefix(25)))
        if let data = try? JSONEncoder().encode(batch) {
            link.send("reviews", data: data, key: batch.reviews.map(\.id).joined(separator: ","))
        }
    }
    private func updateWidget() {
        guard ready, !demo else { return }
        guard let url = WatchSummary.url else { widgetWarning = "表盘共享存储不可用，请检查 App Group 签名"; return }
        let summary = WatchSummary(updatedAt: Date(), syncedAt: study.snapshot?.generatedAt,
                                   dueDates: study.progress.values.map(\.due),
                                   remainingInRound: study.round.queue.count, pendingCount: study.pending.count)
        do {
            try JSONEncoder().encode(summary).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            widgetWarning = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch { widgetWarning = "表盘摘要更新失败；复习记录已保存在本机" }
    }
}
