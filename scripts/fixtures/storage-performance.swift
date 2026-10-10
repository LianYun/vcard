import Foundation

// Synthetic data only. All files and queued backups are drained before cleanup.
@main struct StoragePerformance {
    static func elapsed<T>(_ operation: () throws -> T) rethrows -> (T, Double) {
        let start = Date(); let value = try operation()
        return (value, Date().timeIntervalSince(start) * 1000)
    }
    @MainActor static func main() async throws {
        for count in [10_000, 50_000] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("vibe-perf-" + UUID().uuidString)
            let numbers = try await EventWorkers.run { () -> (Double, Double, Double, Int) in
                let eventsURL = directory.appendingPathComponent("events")
                try FileManager.default.createDirectory(at: eventsURL, withIntermediateDirectories: true)
                let card = Card(id: "perf", front: "synthetic", back: "fixture")
                var add = SyncEvent(kind: .add, card: card); add.timestamp = 1
                var all = [add]
                for index in 1..<count {
                    var event = SyncEvent(kind: .review, progress: SchedulingState(cardId: card.id))
                    event.id = "sample-\(index)"; event.timestamp = Double(index + 1)
                    event.before = SchedulingState(cardId: card.id); event.quality = 4
                    all.append(event)
                }
                // Ten events per immutable file exercises enumeration of 1k / 5k files.
                for offset in stride(from: 0, to: all.count, by: 10) {
                    let data = try OpenFormat.encode(EventFile(events: Array(all[offset..<min(offset + 10, all.count)])))
                    try data.write(to: eventsURL.appendingPathComponent(OpenFormat.digest(data) + ".json"))
                }
                let store = try JSONEventStore(directory: directory)
                let (_, opening) = try elapsed { try store.snapshot() }
                var ratings: [Double] = []
                for _ in 0..<40 {
                    let (_, time) = try elapsed { try store.commit { [$0.reviewEvent(cardId: card.id, grade: .again)] } }
                    ratings.append(time)
                }
                ratings.sort()
                let revision = try store.snapshot().revision
                let (_, reads) = try elapsed { for _ in 0..<40 { _ = try store.snapshot() } }
                let verified = try store.snapshot().revision; precondition(verified == revision)
                return (opening, ratings[Int(Double(ratings.count) * 0.95)], reads / 40, count / 10)
            }
            print("events=\(count) files=\(numbers.3) open_ms=\(Int(numbers.0)) rating_p95_ms=\(Int(numbers.1)) cached_read_ms=\(numbers.2)")
            _ = try await EventWorkers.run(on: EventWorkers.sync) { () }
            try FileManager.default.removeItem(at: directory)
        }
    }
}
