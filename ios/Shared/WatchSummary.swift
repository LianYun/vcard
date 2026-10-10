import Foundation

struct WatchSummary: Codable {
    var updatedAt: Date
    var syncedAt: Date?
    var dueDates: [String]
    var remainingInRound: Int
    var pendingCount: Int
    func due(on day: String = Day.key()) -> Int { dueDates.filter { $0 <= day }.count }
    static let empty = WatchSummary(updatedAt: .distantPast, syncedAt: nil, dueDates: [], remainingInRound: 0, pendingCount: 0)
    static var url: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "WatchAppGroup") as? String else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("watch-summary.json")
    }
    static func load() -> WatchSummary {
        guard let url, let data = try? Data(contentsOf: url), let summary = try? JSONDecoder().decode(Self.self, from: data) else { return .empty }
        return summary
    }
}
