import SwiftUI
import AVFoundation

@MainActor
final class Speaker: ObservableObject {
    static let shared = Speaker()
    private let synthesizer = AVSpeechSynthesizer()
    func speak(_ text: String, english: Bool = true) {
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: english ? "en-US" : "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * (english ? 0.85 : 0.95)
        synthesizer.speak(utterance)
    }
}

struct SpeakButton: View {
    let text: String
    var english = true
    @ObservedObject private var speaker = Speaker.shared
    var body: some View {
        Button { speaker.speak(text, english: english) } label: { Image(systemName: "speaker.wave.2") }
            .buttonStyle(.borderless).accessibilityLabel("朗读 \(text)")
    }
}

struct StudyView: View {
    @EnvironmentObject private var store: AppStore
    @State private var flipped = false
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let card = store.queue.first {
                    ProgressView(value: Double(store.done), total: Double(max(1, store.total)))
                    Text("已完成 \(store.done) / \(store.total)").font(.caption).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 20) {
                        HStack {
                            Text(flipped ? "释义" : "单词").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            SpeakButton(text: flipped && !isEnglish(card.front) ? card.back : card.front,
                                        english: flipped || isEnglish(card.front))
                        }
                        if flipped {
                            Text(card.front).font(.title2.bold()).foregroundStyle(.indigo)
                            MarkdownView(content: card.back)
                            if let example = card.example, !example.isEmpty {
                                HStack { Text(example).italic(); SpeakButton(text: example) }
                            }
                        } else { MarkdownView(content: card.front).font(.largeTitle.bold()).frame(maxWidth: .infinity, minHeight: 180) }
                        Button(flipped ? "查看正面" : "点击查看释义") { flipped.toggle() }
                            .frame(maxWidth: .infinity).keyboardShortcut(.space, modifiers: [])
                    }
                    .padding(24).background(.background, in: RoundedRectangle(cornerRadius: 24))
                    if flipped {
                        HStack {
                            ForEach(ReviewGrade.allCases, id: \.rawValue) { grade in
                                Button(grade.title) { store.review(grade); flipped = false }
                                    .buttonStyle(.borderedProminent)
                                    .tint(grade == .again ? .red : grade == .hard ? .orange : grade == .good ? .indigo : .green)
                                    .keyboardShortcut(KeyEquivalent(grade.shortcut), modifiers: [])
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("今日学习完成", systemImage: "checkmark.seal", description:
                        Text("共完成 \(store.done) 张，其中重学 \(store.relearned) 次。明天见。"))
                    Button("重新检查") { store.startSession() }.buttonStyle(.bordered)
                }
            }.padding()
        }
        .background(Color(.systemGroupedBackground)).navigationTitle("Vibe Word")
        .onAppear { store.startSession(); flipped = false }
        .onChange(of: store.queue.first?.id) { _, _ in flipped = false }
    }
    private func isEnglish(_ text: String) -> Bool { text.range(of: "^[a-zA-Z]", options: .regularExpression) != nil }
}
