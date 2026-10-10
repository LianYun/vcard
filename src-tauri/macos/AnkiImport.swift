import Foundation
import AppKit
import UniformTypeIdentifiers

struct PreparedAnki: Codable {
    var name: String
    var cards: [Card]
    var decks: [Deck]
    var warnings: [String]
    var mediaCount: Int
}
struct RawAnki: Decodable {
    struct Field: Decodable { var name: String; var ord: Int }
    struct Template: Decodable { var ord: Int; var name: String; var qfmt: String; var afmt: String }
    struct Model: Decodable { var name: String; var kind: Int; var css: String?; var fields: [Field]; var templates: [Template] }
    struct Row: Decodable { var guid: String; var model: String; var values: [String]; var tags: [String]; var ord: Int; var deck: String; var sourceId: String }
    var name: String; var models: [String: Model]; var decks: [String: String]; var cards: [Row]; var media: [String: String]; var warnings: [String]
}
enum AnkiImport {
    static func checkedStage(_ path: String, base: URL) throws -> URL {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent() == base.appendingPathComponent("anki-staging").standardizedFileURL,
              UUID(uuidString: url.lastPathComponent) != nil else { throw OpenFormat.failure("导入会话无效") }
        return url
    }
    static func replace(_ text: String, pattern: String, transform: (String) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
        var result = text
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let range = Range(match.range, in: result), let value = Range(match.range(at: 1), in: text) else { continue }
            result.replaceSubrange(range, with: transform(String(text[value])))
        }
        return result
    }
    static func mediaHTML(_ html: String, media: [String: String]) -> String {
        var result = replace(html, pattern: "\\[sound:([^\\]]+)\\]") { name in
            guard let id = media[name] else { return "<span>音频缺失：\(AnkiRenderer.escaped(name))</span>" }
            return "<audio controls preload=\"none\" src=\"vibe-media:\(id)\"></audio>"
        }
        result = replace(result, pattern: "(?:src)\\s*=\\s*[\"']([^\"']+)[\"']") { name in
            if name.hasPrefix("vibe-media:"), MediaStore.valid(String(name.dropFirst(11))) { return "src=\"\(name)\"" }
            let decoded = (name.removingPercentEncoding ?? name).replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#39;", with: "'")
            if let id = media[decoded] { return "src=\"vibe-media:\(id)\"" }
            return "alt=\"附件缺失：\(AnkiRenderer.escaped(name))\" data-missing=\"\(AnkiRenderer.escaped(name))\""
        }
        // Imported content is rendered with scripts disabled on iOS and DOMPurify on desktop.
        result = result.replacingOccurrences(of: "(?is)<(script|iframe|object|embed|style|link|base|meta)\\b[^>]*>.*?</\\1\\s*>", with: "", options: .regularExpression)
        result = result.replacingOccurrences(of: "(?is)<(?:script|iframe|object|embed|style|link|base|meta)\\b[^>]*>", with: "", options: .regularExpression)
        result = result.replacingOccurrences(of: "(?is)\\s+(?:on[a-z]+|style|srcset)\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)", with: "", options: .regularExpression)
        return result
    }
    static func prepare(stage: URL, mappings: [String: [String: String]] = [:]) throws -> PreparedAnki {
        let rawURL = stage.appendingPathComponent("raw.json")
        guard (try rawURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 128_000_000 else { throw OpenFormat.failure("导入索引过大") }
        let raw = try JSONDecoder().decode(RawAnki.self, from: Data(contentsOf: rawURL))
        var cards: [Card] = [], warnings = raw.warnings, decks: [String: Deck] = [:]
        func deckID(_ path: String) -> String {
            var parent: String?, accumulated = ""
            for part in path.components(separatedBy: "::") where !part.isEmpty {
                accumulated += (accumulated.isEmpty ? "" : "::") + part
                let sourceID = raw.decks.first(where: { $0.value == accumulated })?.key ?? accumulated
                let id = "anki-deck:" + OpenFormat.digest(Data(sourceID.utf8))
                decks[id] = Deck(id: id, name: part, parentId: parent); parent = id
            }
            return parent ?? "default"
        }
        if raw.models.values.contains(where: { $0.templates.contains { $0.qfmt.lowercased().contains("<script") || $0.afmt.lowercased().contains("<script") } }) { warnings.append("模板脚本不会执行，请检查预览；复杂交互题可能需要字段映射") }
        if raw.models.values.contains(where: { !($0.css ?? "").isEmpty }) { warnings.append("保留模板原文，显示采用应用统一排版，不应用牌组自定义 CSS") }
        for row in raw.cards {
            do {
                guard let model = raw.models[row.model], var template = model.templates.first(where: { $0.ord == (model.kind == 1 ? 0 : row.ord) }) else { throw OpenFormat.failure("缺少笔记类型或模板") }
                if let mapping = mappings[row.model], let front = mapping["front"], let back = mapping["back"],
                   model.fields.contains(where: { $0.name == front }), model.fields.contains(where: { $0.name == back }), model.kind != 1 {
                    template.qfmt = "{{" + front + "}}"; template.afmt = "{{" + back + "}}"
                }
                if model.name.lowercased().contains("image occlusion") { throw OpenFormat.failure("暂不支持图片遮挡题") }
                var fields: [String: String] = [:]
                for field in model.fields { guard row.values.indices.contains(field.ord) else { throw OpenFormat.failure("笔记字段缺失") }; fields[field.name] = mediaHTML(row.values[field.ord], media: raw.media) }
                let deck = raw.decks[row.deck] ?? "Default"
                fields["Tags"] = row.tags.joined(separator: " "); fields["Deck"] = AnkiRenderer.escaped(deck)
                fields["Subdeck"] = AnkiRenderer.escaped(deck.components(separatedBy: "::").last ?? deck)
                fields["Type"] = AnkiRenderer.escaped(model.name); fields["Card"] = AnkiRenderer.escaped(template.name)
                let note = AnkiNote(guid: row.guid, model: row.model, fields: fields, question: mediaHTML(template.qfmt, media: raw.media), answer: mediaHTML(template.afmt, media: raw.media), css: model.css ?? "", ordinal: row.ord, cloze: model.kind == 1)
                let front = try AnkiRenderer.render(note, back: false), back = try AnkiRenderer.render(note, back: true, front: front)
                if front.contains("data-missing=") || back.contains("data-missing=") || front.contains("音频缺失：") || back.contains("音频缺失：") { warnings.append("卡片 \(row.sourceId)：包含缺失或不支持的附件，请检查预览") }
                guard !front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw OpenFormat.failure("空白卡片") }
                let identity = OpenFormat.digest(Data((row.guid + ":" + row.model).utf8))
                var card = Card(id: "custom:anki:\(identity):\(row.ord)", front: front, back: back)
                card.noteId = "anki-note:" + identity; card.deckId = deckID(deck); card.tags = row.tags; card.anki = note
                cards.append(card)
            } catch { warnings.append("卡片 \(row.sourceId)：\(error.localizedDescription)") }
        }
        guard Set(cards.map(\.id)).count == cards.count else { throw OpenFormat.failure("来源包含冲突的笔记标识，未导入") }
        let prepared = PreparedAnki(name: raw.name, cards: cards, decks: decks.values.sorted { $0.id < $1.id }, warnings: warnings, mediaCount: raw.media.count)
        try OpenFormat.encode(prepared).write(to: stage.appendingPathComponent("prepared.json"), options: .atomic)
        return prepared
    }
    static func read(_ stage: URL) throws -> PreparedAnki { try JSONDecoder().decode(PreparedAnki.self, from: Data(contentsOf: stage.appendingPathComponent("prepared.json"))) }
}
