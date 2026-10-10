import Foundation

/// UTF-8 text/CSV input shared by AI source import and direct card import.
enum TextImport {
    static func structuredCards(_ data: Data, name: String) throws -> CardFile {
        switch (name as NSString).pathExtension.lowercased() {
        case "csv": return try cardFile(data)
        case "json": return try CardFile.decode(data)
        case "jsonl":
            let lines = try decode(data).split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            guard !lines.isEmpty, lines.count <= 100_000 else { throw DocumentImport.failure("JSONL 卡片数量无效") }
            let cards = try lines.map { try JSONDecoder().decode(Card.self, from: Data($0.utf8)) }
            return try CardFile.decode(OpenFormat.encode(CardFile(cards: cards)))
        default: throw DocumentImport.failure("不是卡片文件")
        }
    }
    static func decode(_ data: Data) throws -> String {
        guard data.count <= 20 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else {
            throw DocumentImport.failure("文本文件需使用 UTF-8 编码且不超过 20 MB；请在编辑器或 Excel 中另存为 UTF-8")
        }
        let value = text.hasPrefix("\u{feff}") ? String(text.dropFirst()) : text
        guard !value.contains("\0") else { throw DocumentImport.failure("文件包含无效文本字符") }
        return value.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }
    static func csv(_ data: Data) throws -> [[String]] {
        let text = try decode(data)
        var rows: [[String]] = [], row: [String] = [], field = "", quoted = false, closed = false
        let chars = Array(text)
        var index = 0
        func finishRow() throws {
            row.append(field); field = ""; closed = false
            if row != [""] { rows.append(row) }
            row = []
            guard rows.count <= 100_001 else { throw DocumentImport.failure("CSV 超过 100000 条记录") }
        }
        while index < chars.count {
            let c = chars[index]
            if quoted {
                if c == "\"" {
                    if index + 1 < chars.count && chars[index + 1] == "\"" { field.append("\""); index += 1 }
                    else { quoted = false; closed = true }
                } else { field.append(c) }
            } else if c == "," { row.append(field); field = ""; closed = false }
            else if c == "\n" { try finishRow() }
            else if closed { throw DocumentImport.failure("CSV 第 \(rows.count + 1) 条记录：引号结束后只能是逗号或换行") }
            else if c == "\"" {
                guard field.isEmpty else { throw DocumentImport.failure("CSV 第 \(rows.count + 1) 条记录：双引号需包围整个字段") }
                quoted = true
            } else { field.append(c) }
            index += 1
        }
        guard !quoted else { throw DocumentImport.failure("CSV 存在未闭合的双引号") }
        if !field.isEmpty || !row.isEmpty || closed { try finishRow() }
        guard let first = rows.first else { throw DocumentImport.failure("CSV 为空") }
        let header = first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard header.allSatisfy({ !$0.isEmpty }), Set(header).count == header.count else { throw DocumentImport.failure("CSV 表头不能为空或重复") }
        rows[0] = header
        for (index, row) in rows.dropFirst().enumerated() {
            guard row.count == header.count else { throw DocumentImport.failure("CSV 第 \(index + 2) 条记录列数与表头不一致") }
        }
        return rows
    }
    static func cardFile(_ data: Data) throws -> CardFile {
        let rows = try csv(data), header = rows[0]
        guard ["id", "front", "back"].allSatisfy(header.contains) else { throw DocumentImport.failure("卡片 CSV 必须包含 id、front、back 表头；学习材料请使用「导入文档」") }
        guard header.allSatisfy({ ["id", "front", "back", "example", "createdAt"].contains($0) }) else { throw DocumentImport.failure("卡片 CSV 包含未知列，仅支持 id、front、back、example、createdAt") }
        var cards: [Card] = []
        for (index, row) in rows.dropFirst().enumerated() {
            let fields = Dictionary(uniqueKeysWithValues: zip(header, row))
            var card = Card(id: fields["id"]!, front: fields["front"]!, back: fields["back"]!)
            card.example = fields["example"].flatMap { $0.isEmpty ? nil : $0 }
            if let value = fields["createdAt"], !value.isEmpty {
                guard let timestamp = Double(value), timestamp.isFinite, timestamp >= 0 else { throw DocumentImport.failure("CSV 第 \(index + 2) 条记录 createdAt 必须是非负 Unix 秒数") }
                card.createdAt = timestamp
            }
            cards.append(card)
        }
        // Reuse the same field, duplicate-ID and version validation as JSON.
        return try CardFile.decode(OpenFormat.encode(CardFile(cards: cards)))
    }
}
