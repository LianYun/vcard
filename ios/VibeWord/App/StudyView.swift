import SwiftUI
import AVFoundation

@MainActor
final class Speaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    private let synthesizer = AVSpeechSynthesizer()
    private var currentUtterance: AVSpeechUtterance?

    private override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, english: Bool = true) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            // Explicitly requested speech should remain audible in silent mode.
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            NSLog("Unable to activate speech audio session: %@", error.localizedDescription)
            return
        }

        // Ignore cancellation callbacks from the utterance being replaced.
        currentUtterance = nil
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: english ? "en-US" : "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * (english ? 0.85 : 0.95)
        currentUtterance = utterance
        synthesizer.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.releaseAudioSession(for: id) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.releaseAudioSession(for: id) }
    }

    private func releaseAudioSession(for id: ObjectIdentifier) {
        guard let currentUtterance, ObjectIdentifier(currentUtterance) == id else { return }
        self.currentUtterance = nil
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            NSLog("Unable to deactivate speech audio session: %@", error.localizedDescription)
        }
    }
}

struct SpeakButton: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    let text: String
    var english = true
    @ObservedObject private var speaker = Speaker.shared
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        Button { speaker.speak(text, english: english) } label: {
            Image(systemName: "speaker.wave.2").font(.title3)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }
            .buttonStyle(.borderless).accessibilityLabel(L("朗读 {0}", "\(text)"))
    }
}

struct StudyView: View {
    @State private var previewNow = Date()
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    var exitTitle = "返回复习"
    @State private var flipped = false
    @State private var selectedCardID = ""

    @State private var clockTick = Date()
    @State private var regenerating: Card?
    @State private var editing: Card?
    @State private var details = false
    private var availableCards: [Card] { store.availableStudyCards }
    private var currentCard: Card? {
        availableCards.first { $0.id == selectedCardID } ?? availableCards.first
    }
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .subheadline) private var gradeButtonHeight = 88
    @ScaledMetric(relativeTo: .title3) private var gradeIconHeight = 26

    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        let _ = clockTick
        VStack(spacing: 18) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.indigo)
                    .accessibilityLabel(L("退出学习"))
                    .accessibilityIdentifier("study.exit")
                    ProgressView(value: Double(store.done), total: Double(max(1, store.total)))
                        .tint(.indigo)
                    Text("\(store.done) / \(store.total)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        .fixedSize()
                        .accessibilityLabel(L("已完成 {0}，共 {1} 张", "\(store.done)", "\(store.total)"))
                    Button(L("撤销评分"), systemImage: "arrow.uturn.backward") { Task { await store.undoReview(); flipped = false  } }
                        .labelStyle(.iconOnly).frame(width: 44, height: 44)
                        .disabled(store.lastReviewID == nil).accessibilityIdentifier("study.undo")
                    Menu {
                        if let card = currentCard {
                            Divider()
                            Button(L("今天跳过")) { Task { await store.control(card) { $0.buriedUntil = Day.adding(1, to: Day.key()); $0.buriedBy = nil }  } }
                            Button(L("暂停这张卡")) { Task { await store.control(card) { $0.suspended = true }  } }
                            Button(store.library.controls[card.id]?.marked == true ? L("取消标记") : L("标记卡片")) { Task { await store.control(card) { $0.marked = !($0.marked ?? false) }  } }
                            Button(L("编辑内容")) { editing = card }
                            Button(L("重新生成")) { regenerating = card }.disabled(store.saving || card.anki != nil)
                            if card.anki != nil { Text(L("Anki 模板卡暂不支持重新生成，请使用编辑 Anki 笔记")) }
                            Button(L("学习详情")) { details = true }
                        }
                    } label: { Image(systemName: "ellipsis.circle").frame(width: 44, height: 44) }
                    .accessibilityLabel(L("学习工具"))
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                Text(L("学习范围：{0}", store.sessionScope.label))
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .accessibilityIdentifier("study.scope")
                if store.aheadDays > 0 {
                    Text(L("提前学习 {0} 天", "\(store.aheadDays)"))
                        .font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if currentCard != nil {
                    GeometryReader { geometry in
                        if let card = currentCard {
                            ScrollViewReader { proxy in
                                ScrollView {
                                    studyCard(card, minHeight: geometry.size.height)
                                        .id("study.top")
                                        .accessibilityIdentifier("study.card")
                                        .accessibilityValue(flipped ? card.back : card.front)
                                }
                                .simultaneousGesture(
                                    DragGesture(minimumDistance: 30).onEnded { value in
                                        let horizontal = value.translation.width
                                        guard abs(horizontal) > 50,
                                              abs(horizontal) > abs(value.translation.height) * 1.5 else { return }
                                        browseCard(offset: horizontal < 0 ? 1 : -1)
                                    }
                                )
                                .accessibilityIdentifier("study.content")
                                .onChange(of: currentCard?.id) { _, _ in proxy.scrollTo("study.top", anchor: .top) }
                                .onChange(of: flipped) { _, _ in proxy.scrollTo("study.top", anchor: .top) }
                            }
                        }
                    }
                } else if let waiting = store.waitingUntil, !store.queue.isEmpty {
                    ContentUnavailableView(L("等待重学"), systemImage: "clock", description: Text(L("还有 {0} 张等待重学，{1} 秒后继续。", "\(store.queue.count)", "\(max(0, Int(ceil(waiting / 1000 - clockTick.timeIntervalSince1970))))")))
                    Button(L("稍后继续")) { dismiss() }.buttonStyle(.bordered)
                } else {
                    ContentUnavailableView(L(store.done > 0 ? "今日学习完成" : store.emptyStudyReason), systemImage: "checkmark.seal", description:
                        Text(store.done > 0 ? L("共完成 {0} 张，其中重学 {1} 次。明天见。", "\(store.done)", "\(store.relearned)") : L("可以返回调整范围，或稍后重新检查。")))
                    Button(L("重新检查")) { Task { await store.startSession(ahead: store.aheadDays, scope: store.sessionScope, deckId: store.sessionDeck)  } }.buttonStyle(.bordered)
                    Button(L(exitTitle)) { dismiss() }.buttonStyle(.borderedProminent)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: 640).frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if currentCard != nil { studyActions.disabled(regenerating != nil) }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { clockTick = $0 }
        .sheet(item: $regenerating) { card in RegenerateCardView(card: card) { flipped = false } }
        .sheet(item: $editing) { EditCardView(card: $0) }
        .sheet(isPresented: $details) {
            NavigationStack {
                List {
                    if let card = currentCard {
                        Text(card.front)
                        if let memory = store.library.preparedState(card.id).fsrs {
                            Text("FSRS-6").font(.caption.bold()).foregroundStyle(.purple)
                            Text(L("稳定性 {0} 天", String(format: "%.1f", memory.stability)))
                            Text(L("难度 {0} / 10", String(format: "%.1f", memory.difficulty)))
                            if let probability = FSRSScheduler.retrievability(store.library.preparedState(card.id), config: store.library.schedulerConfig) {
                                Text(L("预计记住概率 {0}%", String(Int((probability * 100).rounded()))))
                            }
                        }
                        Text("\(L("到期")) · \(store.library.progress[card.id]?.due ?? L("新卡"))")
                        ForEach(Array(store.library.reviews.filter { $0.cardId == card.id }.suffix(20).reversed()), id: \.id) { record in
                            HStack { Text(Date(timeIntervalSince1970: record.timestamp / 1000), style: .date); Spacer(); Text(ReviewGrade(rawValue: record.quality)?.title ?? "—"); if record.undone { Text(L("已撤销")) } }
                        }
                    }
                }.navigationTitle(L("学习详情")).toolbar { Button(L("关闭")) { details = false } }
            }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { previewNow = $0 }
        .onAppear { selectedCardID = currentCard?.id ?? ""; flipped = false }
        .onChange(of: currentCard?.id) { _, _ in flipped = false }
        .onChange(of: availableCards.map(\.id)) { _, ids in
            if !ids.contains(selectedCardID) { selectedCardID = ids.first ?? "" }
        }
    }

    private func studyCard(_ card: Card, minHeight: CGFloat) -> some View {
        StudyCardFace(card: card, flipped: card.id == currentCard?.id && flipped, minHeight: minHeight)
            .contentShape(Rectangle())
            .onTapGesture { flipped.toggle() }
            .accessibilityElement(children: .contain)
    }

    private func browseCard(offset: Int) {
        guard !store.saving, let card = currentCard,
              let index = availableCards.firstIndex(where: { $0.id == card.id }) else { return }
        let nextIndex = index + offset
        guard availableCards.indices.contains(nextIndex) else { return }
        selectedCardID = availableCards[nextIndex].id
        flipped = false
    }

    private var studyActions: some View {
        let now = previewNow.timeIntervalSince1970 * 1000
        let before = currentCard.map { store.library.preparedState($0.id) }
        let config = store.library.schedulerConfig
        let previews = before.map { FSRSScheduler.preview($0, config: config, now: now) } ?? [:]
        return VStack(spacing: 10) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10),
                                     count: typeSize.isAccessibilitySize ? 2 : 4), spacing: 10) {
                ForEach(ReviewGrade.allCases, id: \.rawValue) { grade in
                    Button { Task {
                        guard let card = currentCard else { return }
                        if await store.review(grade, cardId: card.id, context: before.map { ReviewContext(now: now, configId: config.id, before: $0) }) { flipped = false }
                     } } label: {
                        VStack(spacing: 8) {
                            if !typeSize.isAccessibilitySize {
                                Image(systemName: gradeSymbol(grade))
                                    .font(.title3.weight(.semibold))
                                    .frame(height: gradeIconHeight)
                            }
                            Text(grade.title).font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .multilineTextAlignment(.center)
                            if let card = currentCard {
                                Text(StudyEngine.label(previews[grade] ?? SchedulingState(cardId: card.id), now: now)).font(.caption2)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, typeSize.isAccessibilitySize ? 12 : 0)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: typeSize.isAccessibilitySize ? 60 : gradeButtonHeight)
                        .contentShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(StudyGradeButtonStyle(color: gradeColor(grade)))
                    .disabled(store.saving)
                    .accessibilityIdentifier("study.grade.\(grade.rawValue)")
                    .keyboardShortcut(KeyEquivalent(grade.shortcut), modifiers: [])
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 12)
        .frame(maxWidth: 640).frame(maxWidth: .infinity)
        .background(.regularMaterial)
    }

    private func gradeSymbol(_ grade: ReviewGrade) -> String {
        switch grade { case .again: "arrow.counterclockwise"; case .hard: "ellipsis"; case .good: "checkmark"; case .easy: "checkmark.circle" }
    }
    private func gradeColor(_ grade: ReviewGrade) -> Color {
        // Deep fills keep white labels readable in both light and dark appearances.
        switch grade {
        case .again: Color(red: 0.68, green: 0.20, blue: 0.24)
        case .hard: Color(red: 0.55, green: 0.34, blue: 0.08)
        case .good: Color(red: 0.32, green: 0.34, blue: 0.78)
        case .easy: Color(red: 0.16, green: 0.44, blue: 0.30)
        }
    }
}

private struct StudyGradeButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.white.opacity(isEnabled ? 1 : 0.7))
            .background(color.opacity(isEnabled ? 1 : 0.55),
                        in: RoundedRectangle(cornerRadius: 16))
            .brightness(configuration.isPressed ? -0.08 : 0)
    }
}

// Shared rendering for scheduled study and quick learning.
struct StudyCardFace: View {
    let card: Card
    let flipped: Bool
    var minHeight: CGFloat = 300
    private func isLong(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).count > 48 || text.contains("\n")
    }
    var body: some View {
        let english = card.front.range(of: "^[a-zA-Z]", options: .regularExpression) != nil
        return VStack(alignment: .leading, spacing: 22) {
            if !flipped {
                HStack {
                    Text(english ? L("单词 / 短语") : L("释义 / 提示"))
                        .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                    Spacer()
                    SpeakButton(text: card.front, english: english)
                }
                Spacer(minLength: 0)
                CardContentView(card: card)
                    .font(isLong(card.front) ? .title3 : .largeTitle.weight(.semibold))
                    .lineSpacing(6).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            if flipped {
                Text(card.front).font(.headline).foregroundStyle(.secondary).textSelection(.enabled)
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(english ? L("释义") : L("英文答案"))
                            .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                        Spacer()
                        if !english { SpeakButton(text: card.back) }
                    }
                    CardContentView(card: card, back: true)
                        .font(!english && !isLong(card.back) ? .title.weight(.semibold) : .body)
                        .lineSpacing(6).foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("study.answer")
                }
                if let example = card.example, !example.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(L("例句")).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                            Spacer()
                            SpeakButton(text: example)
                        }
                        Text(example).font(.body).lineSpacing(5).foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
        .padding(22).frame(maxWidth: .infinity, minHeight: minHeight, alignment: flipped ? .topLeading : .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color(.separator).opacity(0.2), lineWidth: 1))
    }

}

struct RegenerateCardView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let card: Card
    let onSaved: () -> Void
    @State private var requirements = ""
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section(L("当前卡片 · 正面")) { MarkdownView(content: card.front) }
                Section(L("你的要求（选填）")) { TextField(L("生成要求"), text: $requirements, axis: .vertical).lineLimit(4...8).accessibilityIdentifier("regenerate.requirements") }
                Section { Text(L("生成任务将在后台执行，请到任务队列审核后确认替换。")) }
                if let error { Section { Text(localizedMessage(error)).foregroundStyle(.red) } }
            }.disabled(saving).navigationTitle(L("重新生成卡片"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("取消")) { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(L("提交任务")) {
                    guard !saving else { return }; saving = true
                    Task {
                        do { try await store.enqueueReplacement(card, requirements: requirements); dismiss() }
                        catch { self.error = error.localizedDescription; saving = false }
                    }
                }.disabled(saving).accessibilityIdentifier("regenerate.generate") }
            }
        }.interactiveDismissDisabled(saving)
    }
}
