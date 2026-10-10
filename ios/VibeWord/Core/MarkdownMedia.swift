import Foundation

/// Separate embedded audio before Markdown parsing, including inline and multiline tags.
enum MarkdownMedia {
    enum Part: Equatable {
        case text(String)
        case audio(String)
    }

    static func readingBlocks(_ content: String) -> [String] {
        parts(content).flatMap { part in
            switch part {
            case .text(let text): return text.components(separatedBy: "\n\n")
            case .audio(let html): return [html]
            }
        }
    }

    static func parts(_ content: String) -> [Part] {
        let pattern = #"(?is)<audio\b[^>]*>.*?</audio\s*>"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [.text(content)] }
        var result: [Part] = []
        var cursor = content.startIndex
        for match in regex.matches(in: content, range: NSRange(content.startIndex..., in: content)) {
            guard let range = Range(match.range, in: content) else { continue }
            if cursor < range.lowerBound { result.append(.text(String(content[cursor..<range.lowerBound]))) }
            result.append(.audio(String(content[range])))
            cursor = range.upperBound
        }
        if cursor < content.endIndex { result.append(.text(String(content[cursor...]))) }
        return result
    }
}
