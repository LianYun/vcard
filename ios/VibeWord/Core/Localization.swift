import Foundation

public enum AppLanguage {
    public static let key = "vibe-word.interface-language"
    public static var defaults: UserDefaults {
        #if os(watchOS)
        if let group = Bundle.main.object(forInfoDictionaryKey: "WatchAppGroup") as? String,
           let defaults = UserDefaults(suiteName: group) { return defaults }
        #endif
        return .standard
    }
    public static func resolve(_ preference: String, languages: [String]) -> String {
        if preference == "en" || preference == "zh-Hans" { return preference }
        for language in languages {
            let code = language.lowercased().split(separator: "-").first
            if code == "zh" { return "zh-Hans" }
            if code == "en" { return "en" }
        }
        return "en"
    }
    public static var current: String {
        resolve(defaults.string(forKey: key) ?? "system", languages: Locale.preferredLanguages)
    }
    public static var locale: Locale { Locale(identifier: current) }
}

/// Interpolates after translation so user content is never treated as a localization key.
public func L(_ key: String, _ arguments: String...) -> String {
    let template = AppLanguage.current == "en" ? englishMessages[key] ?? key : key
    let regex = try! NSRegularExpression(pattern: #"\{(\d+)\}"#)
    var result = template
    for match in regex.matches(in: template, range: NSRange(template.startIndex..., in: template)).reversed() {
        guard let indexRange = Range(match.range(at: 1), in: template),
              let index = Int(template[indexRange]), index < arguments.count,
              let range = Range(match.range, in: result) else { continue }
        result.replaceSubrange(range, with: arguments[index])
    }
    return result
}

/// Legacy storage and connectivity messages remain stable in state and are translated at display time.
public func localizedMessage(_ message: String) -> String {
    guard AppLanguage.current == "en" else { return message }
    if let translated = englishMessages[message] { return translated }
    for (key, translated) in englishMessages.sorted(by: { $0.key.count > $1.key.count }) where key.contains("{0}") {
        let parts = key.components(separatedBy: try! NSRegularExpression(pattern: #"\{\d+\}"#))
        let pattern = "^" + parts.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "(.*?)") + "$"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .dotMatchesLineSeparators),
              let match = regex.firstMatch(in: message, range: NSRange(message.startIndex..., in: message)) else { continue }
        var output = translated
        for i in (1..<match.numberOfRanges).reversed() {
            if let range = Range(match.range(at: i), in: message) {
                output = output.replacingOccurrences(of: "{\(i - 1)}", with: String(message[range]))
            }
        }
        return output
    }
    return message
}

private extension String {
    func components(separatedBy regex: NSRegularExpression) -> [String] {
        var parts: [String] = [], start = startIndex
        for match in regex.matches(in: self, range: NSRange(startIndex..., in: self)) {
            guard let range = Range(match.range, in: self) else { continue }
            parts.append(String(self[start..<range.lowerBound])); start = range.upperBound
        }
        parts.append(String(self[start...])); return parts
    }
}
