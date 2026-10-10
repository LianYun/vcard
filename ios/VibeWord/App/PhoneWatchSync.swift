import Foundation
import Combine

@MainActor
final class PhoneWatchSync: ObservableObject {
    @Published private(set) var status = "等待 Apple Watch 连接"
    let link = WatchLink()
    private let persistence: Persistence
    private let defaults: UserDefaults
    private let sourceID: String
    private var deviceID: String?
    private var acknowledged = Set<String>()
    private var receiving: Task<Void, Never>?
    private var scheduled: Task<Void, Never>?

    init(persistence: Persistence) {
        self.persistence = persistence
        defaults = UserDefaults.standard
        let key = Persistence.isLocalPreview ? "watch.preview.source" : "watch.source"
        sourceID = defaults.string(forKey: key) ?? UUID().uuidString
        defaults.set(sourceID, forKey: key)
        link.onData = { [weak self] kind, data in
            guard let self else { return }
            let previous = self.receiving
            self.receiving = Task { await previous?.value; await self.receive(kind, data) }
        }
        link.onReady = { [weak self] in self?.refresh() }
        link.activate()
    }
    func refresh() {
        scheduled?.cancel()
        scheduled = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            await self?.publish()
        }
    }
    private func receive(_ kind: String, _ data: Data) async {
        guard persistence.ready else { status = "数据库准备中，手表会重试"; return }
        do {
            guard data.count < 64_000 else { throw WatchStudyError.invalidData }
            if kind == "request" {
                let request = try JSONDecoder().decode(WatchRequest.self, from: data)
                guard UUID(uuidString: request.deviceID) != nil, request.pendingIDs.count <= 25 else { throw WatchStudyError.invalidData }
                if deviceID != request.deviceID { acknowledged = [] }
                deviceID = request.deviceID
                acknowledged.formUnion(request.pendingIDs)
            } else if kind == "reviews" {
                let batch = try JSONDecoder().decode(WatchReviewBatch.self, from: data)
                try batch.validate()
                guard batch.sourceID == sourceID else { throw WatchStudyError.differentPhone }
                if deviceID != batch.deviceID { acknowledged = [] }
                deviceID = batch.deviceID
                // Import IDs only once at the storage boundary, not merely in UI
                // projection. Duplicate background + interactive delivery is normal.
                try await persistence.append(batch.reviews.map(\.event))
                acknowledged.formUnion(batch.reviews.map(\.id))
            } else { return }
            scheduled?.cancel()
            await publish() // Queue the acknowledgement before the receive handler finishes.
        } catch { status = "手表同步未完成：\(error.localizedDescription)" }
    }
    private func publish() async {
        guard persistence.ready, link.activated, link.installed else { status = link.status; return }
        guard let deviceID else { status = "请在手表上打开 Vibe Word，接收学习卡片"; return }
        do {
            let key = "watch.revision.\(sourceID)"
            let revision = defaults.integer(forKey: key) + 1
            defaults.set(revision, forKey: key)
            let sourceID = sourceID, acknowledgedIDs = Array(acknowledged)
            let (data, count) = try await persistence.perform { store in
                let snapshot = WatchSnapshot(events: try store.load(), sourceID: sourceID,
                    deviceID: deviceID, revision: revision, acknowledgedIDs: acknowledgedIDs,
                    library: try store.snapshot().library)
                return (try JSONEncoder().encode(snapshot), snapshot.cards.count)
            }
            guard data.count <= 8_000_000 else { throw WatchStudyError.invalidData }
            try link.sendSnapshot(data, revision: revision)
            status = "已排队发送 \(count) 张卡片；到达时间由系统决定"
        } catch { status = "手表同步未完成：\(error.localizedDescription)" }
    }
}
