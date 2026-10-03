import Foundation

public struct GenerationService: Sendable {
    private let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }
    struct WordResponse: Decodable {
        var word: String; var phonetic: String; var definition: String
        var example: String; var exampleTranslation: String
        var etymology: String; var roots: String; var similar: String; var chineseHint: String
    }
    struct ChatResponse: Decodable {
        struct Choice: Decodable {
            struct Message: Decodable { var content: String? }
            var message: Message
        }
        var choices: [Choice]
    }
    struct ImageResponse: Decodable {
        struct Item: Decodable { var url: String?; var b64_json: String? }
        var data: [Item]
    }
    public struct Failure: LocalizedError {
        public var message: String
        public var errorDescription: String? { message }
        public init(_ message: String) { self.message = message }
    }
    func request(_ config: APIConfig, path: String, body: [String: Any]) async throws -> Data {
        let base = config.baseURL.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard let url = URL(string: base + path), ["https", "http"].contains(url.scheme ?? ""), url.host != nil else {
            throw Failure("API 地址无效")
        }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            // Never surface an untrusted response body: providers sometimes echo credentials.
            throw Failure("API 请求失败（HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)）")
        }
        try Task.checkCancellation()
        return data
    }
    func chat(_ config: APIConfig, system: String, user: String, temperature: Double) async throws -> String {
        let data = try await request(config, path: "/chat/completions", body: [
            "model": config.model, "temperature": temperature,
            "messages": [["role": "system", "content": system], ["role": "user", "content": user]]
        ])
        guard let content = try JSONDecoder().decode(ChatResponse.self, from: data).choices.first?.message.content,
              !content.isEmpty else { throw Failure("模型返回了空内容") }
        return content
    }
    public static func extractJSON(_ text: String) -> Data {
        if let expression = try? NSRegularExpression(pattern: "```(?:json)?\\s*([\\s\\S]*?)```"),
           let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let range = Range(match.range(at: 1), in: text) { return Data(text[range].utf8) }
        if let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start <= end {
            return Data(text[start...end].utf8)
        }
        return Data(text.utf8)
    }
    public func generate(word: String, config: APIConfig, image: APIConfig) async throws -> [Card] {
        let content = try await chat(config, system: Prompts.cards, user: word, temperature: 0.3)
        let r: WordResponse
        do { r = try JSONDecoder().decode(WordResponse.self, from: Self.extractJSON(content)) }
        catch { throw Failure("无法解析模型返回的 JSON，请重试") }
        let word = r.word.isEmpty ? word : r.word
        var back = "*\(r.phonetic)*\n\n\(r.definition)\n\n> \(r.example)\n> *\(r.exampleTranslation)*\n\n**词源** \(r.etymology)\n\n**词根** \(r.roots)\n\n**相似** \(r.similar)"
        if image.isConfigured && !r.example.isEmpty {
            do {
                let prompt = try await chat(config, system: Prompts.image,
                                            user: "Word: \(word)\nExample: \(r.example)", temperature: 0.7)
                let data = try await request(image, path: "/images/generations", body: [
                    "model": image.model, "prompt": prompt.trimmingCharacters(in: CharacterSet(charactersIn: "\"'`\n ")),
                    "n": 1, "size": "1024x1024", "response_format": "url"
                ])
                let item = try JSONDecoder().decode(ImageResponse.self, from: data).data.first
                // Persist actual image bytes, not expiring provider URLs, with the card in iCloud.
                var imageData: Data?
                if let encoded = item?.b64_json { imageData = Data(base64Encoded: encoded) }
                else if let raw = item?.url, let url = URL(string: raw), url.scheme == "https" {
                    let (bytes, response) = try await session.data(from: url)
                    if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                       http.mimeType?.hasPrefix("image/") == true { imageData = bytes }
                }
                if let imageData, imageData.count <= 15 * 1024 * 1024 {
                    back = "![\(word)](data:image/png;base64,\(imageData.base64EncodedString()))\n\n" + back
                }
            } catch {
                try Task.checkCancellation() // Image failure preserves text cards; cancellation does not.
            }
        }
        try Task.checkCancellation()
        return [Card(front: word, back: back),
                Card(front: "\(r.chineseHint)\n（提示：\(r.roots)）", back: word, example: r.example)]
    }
}
