import Foundation

public struct AIDraft: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var direction: String
    public var card: Card
    public var status = "ready"
    public var revision = 0
    public init(id: String, direction: String, card: Card) { self.id = id; self.direction = direction; self.card = card }
}
public struct AITask: Codable, Identifiable, Sendable {
    public var id: String
    public var kind: String
    public var word: String
    public var requirements: String
    public var status = "queued"
    public var enqueuedAt = Date().timeIntervalSince1970 * 1000
    public var startedAt: Double?
    public var finishedAt: Double?
    public var model: String?
    public var error: String?
    public var warning: String?
    public var expected: Card?
    public var targetTaskID: String?
    public var targetDraftID: String?
    public var targetRevision: Int?
    public var drafts: [AIDraft] = []
    public init(word: String, expected: Card? = nil, requirements: String = "") {
        id = UUID().uuidString; self.word = word; self.expected = expected; self.requirements = requirements
        kind = expected == nil ? "word" : "replacement"
    }
    public var readyCount: Int { drafts.filter { $0.status == "ready" }.count }
}
public struct AITaskFile: Codable, Sendable {
    public var version = 1
    public var tasks: [AITask]
    public init(tasks: [AITask]) { self.tasks = tasks }
    public static func load(from url: URL) throws -> [AITask] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let file = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        guard file.version == 1 else { throw OpenFormat.failure("任务队列格式无效，请备份后检查") }
        return file.tasks.map { task in var task = task; if ["queued", "running"].contains(task.status) { task.status = "paused" }; return task }
    }
    public func save(to url: URL) throws {
        let data = try JSONEncoder().encode(self)
        guard data.count <= 50 * 1024 * 1024 else { throw OpenFormat.failure("导入草稿超过 50 MB，请删除旧任务后重试") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic])
    }
}
