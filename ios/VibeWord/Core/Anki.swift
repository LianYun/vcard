import Foundation

public struct Deck: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var parentId: String?
    public var newCardsPerDay: Int?
    public init(id: String, name: String, parentId: String? = nil, newCardsPerDay: Int? = nil) {
        self.id = id; self.name = name; self.parentId = parentId; self.newCardsPerDay = newCardsPerDay
    }
    public static let defaultDeck = Deck(id: "default", name: "默认牌组")
}
public enum AnkiRenderer {
    public static func escaped(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
    private indirect enum Node { case text(String), blank([Int], [Node], String?) }
    private static func nodes(_ text: String, depth: Int = 0) throws -> [Node] {
        guard depth < 32 else { throw OpenFormat.failure("Cloze 嵌套过深") }
        var result: [Node] = [], cursor = text.startIndex
        while let start = text.range(of: "{{c", range: cursor..<text.endIndex) {
            result.append(.text(String(text[cursor..<start.lowerBound])))
            guard let divider = text.range(of: "::", range: start.upperBound..<text.endIndex) else { throw OpenFormat.failure("Cloze 缺少分隔符") }
            let ids = text[start.upperBound..<divider.lowerBound].split(separator: ",").compactMap { Int($0) }
            guard !ids.isEmpty, ids.allSatisfy({ $0 > 0 }), ids.count == text[start.upperBound..<divider.lowerBound].split(separator: ",").count else { throw OpenFormat.failure("Cloze 编号无效") }
            var level = 1, index = divider.upperBound, end: String.Index?, hint: Range<String.Index>?
            while index < text.endIndex {
                if text[index...].hasPrefix("{{") { level += 1; index = text.index(index, offsetBy: 2) }
                else if text[index...].hasPrefix("}}") {
                    level -= 1
                    if level == 0 { end = index; break }; index = text.index(index, offsetBy: 2)
                } else if level == 1 && text[index...].hasPrefix("::") {
                    hint = index..<text.index(index, offsetBy: 2); index = text.index(index, offsetBy: 2)
                } else { index = text.index(after: index) }
            }
            guard let end else { throw OpenFormat.failure("Cloze 缺少结束标记") }
            let body = String(text[divider.upperBound..<(hint?.lowerBound ?? end)])
            result.append(.blank(ids, try nodes(body, depth: depth + 1), hint.map { String(text[$0.upperBound..<end]) }))
            cursor = text.index(end, offsetBy: 2)
        }
        result.append(.text(String(text[cursor...])))
        return result
    }
    public static func clozeNumbers(_ text: String) throws -> Set<Int> {
        func collect(_ items: [Node]) -> Set<Int> { items.reduce(into: Set<Int>()) { result, item in
            if case let .blank(ids, children, _) = item { result.formUnion(ids); result.formUnion(collect(children)) }
        } }
        return collect(try nodes(text))
    }
    public static func cloze(_ text: String, number: Int, answer: Bool) throws -> String {
        func render(_ items: [Node]) -> String { items.map { item in
            switch item {
            case .text(let value): return value
            case let .blank(ids, children, hint):
                if ids.contains(number) { return answer ? "<strong class=\"cloze\">\(render(children))</strong>" : "<strong class=\"cloze\">[\(escaped(hint ?? "…"))]</strong>" }
                return render(children)
            }
        }.joined() }
        return render(try nodes(text))
    }
    public static func render(_ note: AnkiNote, back: Bool, front: String = "") throws -> String {
        var fields = note.fields; fields["FrontSide"] = front
        func template(_ text: String, depth: Int = 0) throws -> String {
            guard depth < 32 else { throw OpenFormat.failure("模板嵌套过深") }
            var result = "", cursor = text.startIndex
            while let open = text.range(of: "{{", range: cursor..<text.endIndex) {
                result += text[cursor..<open.lowerBound]
                guard let close = text.range(of: "}}", range: open.upperBound..<text.endIndex) else { throw OpenFormat.failure("模板标记未闭合") }
                let token = String(text[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                cursor = close.upperBound
                if token.hasPrefix("#") || token.hasPrefix("^") {
                    let name = String(token.dropFirst()); var nesting = 1, search = cursor, finish: Range<String.Index>?
                    while let next = text.range(of: "{{", range: search..<text.endIndex), let stop = text.range(of: "}}", range: next.upperBound..<text.endIndex) {
                        let key = String(text[next.upperBound..<stop.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                        if key == "#" + name || key == "^" + name { nesting += 1 }
                        if key == "/" + name { nesting -= 1 }
                        if nesting == 0 { finish = next.lowerBound..<stop.upperBound; break }; search = stop.upperBound
                    }
                    guard let finish else { throw OpenFormat.failure("条件模板未闭合：\(name)") }
                    let present = !(fields[name] ?? "").replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    if present != token.hasPrefix("^") { result += try template(String(text[cursor..<finish.lowerBound]), depth: depth + 1) }
                    cursor = finish.upperBound
                } else {
                    var parts = token.components(separatedBy: ":"); let name = parts.removeLast()
                    guard let field = fields[name] else { throw OpenFormat.failure("未知模板字段：\(name)") }
                    var value = field
                    for filter in parts.reversed() {
                        switch filter {
                        case "cloze": value = try cloze(value, number: note.ordinal + 1, answer: back)
                        case "text": value = value.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                        default: throw OpenFormat.failure("暂不支持模板过滤器：\(filter)")
                        }
                    }
                    result += value
                }
            }
            result += text[cursor...]; return result
        }
        return try template(back ? note.answer : note.question)
    }
}
public extension Library {
    func deckAncestors(_ id: String) -> [String] {
        var result: [String] = [], next: String? = id
        while let current = next, !result.contains(current) {
            result.append(current); next = decks.first(where: { $0.id == current })?.parentId
        }
        return result
    }
    func inDeck(_ card: Card, _ id: String?) -> Bool { id == nil || deckAncestors(card.deckId ?? "default").contains(id!) }
    func deckPath(_ id: String) -> String { deckAncestors(id).reversed().map { id in decks.first { $0.id == id }?.name ?? id }.joined(separator: "::") }
    func issueEvents(_ ids: [String], day: String = Day.key()) -> [SyncEvent] {
        var used = issued[day]?.count ?? 0, budgets = deckIssued[day] ?? [:], seen = Set<String>(), groups = Set<String>(), result: [SyncEvent] = []
        for id in ids {
            guard seen.insert(id).inserted, used < newCardsPerDay,
                  let card = cards.first(where: { $0.id == id }), StudyEngine.isNew(progress[id]), controls[id]?.available(on: day) ?? true else { continue }
            let ancestors = deckAncestors(card.deckId ?? "default")
            guard ancestors.allSatisfy({ ancestor in decks.first { $0.id == ancestor }?.newCardsPerDay.map { (budgets[ancestor]?.count ?? 0) < $0 } ?? true }) else { continue }
            if let group = card.noteId, !groups.insert(group).inserted { continue }
            var event = SyncEvent(kind: .issued, cardId: id); event.day = day; event.deckIds = ancestors
            result.append(event); used += 1
            for ancestor in ancestors { budgets[ancestor, default: []].insert(id) }
        }
        return result
    }
    func saveDeckEvent(_ deck: Deck) throws -> SyncEvent {
        guard !deck.id.isEmpty, !deck.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !deck.name.contains("::"), deck.parentId != deck.id,
              deck.newCardsPerDay.map({ $0 >= 0 && $0 <= 100_000 }) ?? true,
              deck.parentId.map({ parent in decks.contains { $0.id == parent } && !deckAncestors(parent).contains(deck.id) }) ?? true,
              deck.id != "default" || deck.parentId == nil else { throw OpenFormat.failure("牌组名称、父级或每日上限无效") }
        var event = SyncEvent(kind: .deck); event.deck = deck; return event
    }
    func removeDeckEvents(_ id: String) throws -> [SyncEvent] {
        guard id != "default", decks.contains(where: { $0.id == id }) else { throw OpenFormat.failure("不能删除默认牌组") }
        var events = cards.filter { ($0.deckId ?? "default") == id }.map { card -> SyncEvent in
            var card = card; card.deckId = "default"; return SyncEvent(kind: .edit, card: card)
        }
        for var child in decks.filter({ $0.parentId == id }) {
            child.parentId = decks.first { $0.id == id }?.parentId; var event = SyncEvent(kind: .deck); event.deck = child; events.append(event)
        }
        var event = SyncEvent(kind: .deleteDeck); event.targetId = id; events.append(event); return events
    }
}
public enum MediaStore {
    public static func valid(_ id: String) -> Bool { id.range(of: "^[a-f0-9]{64}\\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|aac|flac|opus)$", options: .regularExpression) != nil }
    public static func mime(_ id: String) -> String {
        let ext = (id as NSString).pathExtension
        return ["png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","gif":"image/gif","webp":"image/webp","mp3":"audio/mpeg","wav":"audio/wav","ogg":"audio/ogg","opus":"audio/ogg","m4a":"audio/mp4","aac":"audio/aac","flac":"audio/flac"][ext] ?? "application/octet-stream"
    }
    public static func install(_ data: Data, id: String, directory: URL) throws {
        guard valid(id), data.count <= 32_000_000, OpenFormat.digest(data) == id.components(separatedBy: ".")[0] else { throw OpenFormat.failure("附件校验失败") }
        let folder = directory.appendingPathComponent("media")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent(id)
        if FileManager.default.fileExists(atPath: target.path) { guard try Data(contentsOf: target) == data else { throw OpenFormat.failure("附件冲突") }; return }
        try data.write(to: target, options: .atomic)
    }
}

public extension Library {
    func editAnkiEvents(id: String, fields: [String: String]) throws -> [SyncEvent] {
        guard let source = cards.first(where: { $0.id == id }), let sourceNote = source.anki, let noteId = source.noteId else { throw OpenFormat.failure("Anki 笔记不存在") }
        let siblings = cards.filter { $0.noteId == noteId && $0.anki != nil }
        var wanted = Set(siblings.compactMap { $0.anki?.ordinal }), result: [SyncEvent] = []
        if sourceNote.cloze {
            wanted = try fields.values.reduce(into: Set<Int>()) { numbers, value in numbers.formUnion(try AnkiRenderer.clozeNumbers(value).map { $0 - 1 }) }
            guard !wanted.isEmpty else { throw OpenFormat.failure("至少保留一个 Cloze 编号") }
        }
        for var card in siblings {
            guard var note = card.anki else { continue }
            if !wanted.contains(note.ordinal) { result.append(SyncEvent(kind: .delete, cardId: card.id)); continue }
            note.fields = fields
            card.front = try AnkiRenderer.render(note, back: false)
            card.back = try AnkiRenderer.render(note, back: true, front: card.front); card.anki = note
            result.append(SyncEvent(kind: .edit, card: card))
        }
        let existing = Set(siblings.compactMap { $0.anki?.ordinal })
        for ordinal in wanted.subtracting(existing).sorted() {
            var card = source, note = sourceNote
            note.ordinal = ordinal; note.fields = fields
            card.id = "custom:anki-edit:" + UUID().uuidString; card.createdAt = Date().timeIntervalSince1970
            card.front = try AnkiRenderer.render(note, back: false)
            card.back = try AnkiRenderer.render(note, back: true, front: card.front); card.anki = note
            result.append(SyncEvent(kind: .add, card: card))
        }
        return result
    }
}

extension Library {
    /// Validate against the latest library and emit one atomic content edit.
    /// Note fields affect siblings; metadata belongs to the selected card.
    public func cardEditorEvents(expected: Card, draft: Card, fields: [String: String]? = nil) throws -> [SyncEvent] {
        guard let current = cards.first(where: { $0.id == expected.id }) else { throw OpenFormat.failure("卡片已删除，请刷新") }
        guard current.front == expected.front, current.back == expected.back,
              (current.example ?? "") == (expected.example ?? ""),
              (current.tags ?? []).sorted() == (expected.tags ?? []).sorted(),
              (current.deckId ?? "default") == (expected.deckId ?? "default"), current.anki == expected.anki else {
            throw OpenFormat.failure("卡片内容已更新，请关闭后重新编辑")
        }
        guard decks.contains(where: { $0.id == (draft.deckId ?? "default") }) else { throw OpenFormat.failure("牌组不存在") }
        if current.anki != nil {
            guard let fields else { throw OpenFormat.failure("请使用“编辑 Anki 笔记”修改原始字段") }
            var events = try editAnkiEvents(id: current.id, fields: fields)
            for index in events.indices where events[index].card?.id == current.id || events[index].kind == .add {
                events[index].card?.tags = draft.tags
                events[index].card?.deckId = draft.deckId
            }
            return events
        }
        var edited = current
        edited.front = draft.front.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !edited.front.isEmpty else { throw OpenFormat.failure("卡片正面不能为空") }
        edited.back = draft.back.trimmingCharacters(in: .whitespacesAndNewlines)
        let example = (draft.example ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        edited.example = example.isEmpty ? nil : example
        edited.tags = draft.tags; edited.deckId = draft.deckId
        return [SyncEvent(kind: .edit, card: edited)]
    }
}
