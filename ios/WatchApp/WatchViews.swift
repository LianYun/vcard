import SwiftUI
import WatchKit
import WidgetKit
import Combine

enum WatchStyle {
    static let accent = Color(red: 0.67, green: 0.64, blue: 1)
    static let mint = Color(red: 0.77, green: 0.96, blue: 0.58)
}

struct WatchRootView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: WatchStore
    @State private var showingRound = false
    @State private var showingSync = false
    @Environment(\.scenePhase) private var phase
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        NavigationStack {
            Group {
                if !store.ready {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                        Text(L("本地数据未能打开")).font(.headline)
                        Button(L("重新读取")) { store.load() }
                    }
                } else if showingRound && store.study.round.isStarted {
                    WatchRoundView { showingRound = false }
                } else {
                    WatchHomeView {
                        store.start()
                        showingRound = store.study.round.isStarted
                    }
                }
            }
            .navigationTitle(showingRound ? "" : "Vibe Word")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !showingRound {
                        Button { showingSync = true } label: { Image(systemName: "gearshape").foregroundStyle(.black) }
                            .accessibilityLabel(L("设置"))
                    }
                }
            }
            .sheet(isPresented: $showingSync) { NavigationStack { WatchSyncView(link: store.link) } }
            .alert(L("操作未完成"), isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                Button(L("知道了")) { store.error = nil }
            } message: { Text(localizedMessage(store.error ?? "")) }
            .onAppear { showingRound = !store.study.round.queue.isEmpty }
            .onOpenURL { url in
                guard url.scheme == "vibeword", url.host == "study" else { return }
                store.start(); showingRound = store.study.round.isStarted
            }
            .onReceive(tick) { _ in if phase == .active { store.tick() } }
        }
    }
}

private struct WatchHomeView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: WatchStore
    let start: () -> Void
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        ScrollView {
            VStack(spacing: 6) {
                if store.study.snapshot == nil {
                    Image(systemName: "iphone.and.arrow.forward").font(.largeTitle).foregroundStyle(WatchStyle.accent)
                    Text(L("从手机带来第一张卡")).font(.headline).multilineTextAlignment(.center)
                    Text(L("请在配对 iPhone 上打开 Vibe Word，添加卡片后同步到手表。"))
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button(L("获取学习卡片")) { store.synchronize() }.accessibilityIdentifier("requestSync")
                } else {
                    Text(L("每天记住一点")).font(.footnote.weight(.semibold))
                    let count = store.study.due().count
                    ZStack {
                        Circle().stroke(.white.opacity(0.12), lineWidth: 6)
                        // Ring shows a real ratio, not an arbitrary completion percentage.
                        Circle().trim(from: 0, to: CGFloat(count) / CGFloat(max(store.study.snapshot?.cards.count ?? 0, 1)))
                            .stroke(WatchStyle.mint, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90))
                        VStack(spacing: 0) {
                            Text("\(count)").font(.system(size: 30, weight: .semibold, design: .rounded))
                            Text(L("张可复习")).font(.caption2).foregroundStyle(.secondary)
                        }
                    }.frame(width: 74, height: 74).padding(3)
                        .accessibilityElement(children: .ignore).accessibilityLabel(L("本机有 {0} 张可复习", "\(count)"))
                    if !store.study.round.queue.isEmpty || count > 0 {
                        Button(store.study.round.queue.isEmpty ? L("开始 {0} 张", "\(min(count, 5))") : L("继续学习"), action: start)
                            .buttonStyle(WatchPrimaryStyle()).accessibilityIdentifier("startRound")
                    } else {
                        Text(L("本机卡片已学完")).font(.headline)
                        Button(L("检查手机更新")) { store.synchronize() }
                    }
                    Text(L("今日已复习 {0} 次", "\(store.study.reviewed())")).font(.caption2).foregroundStyle(.secondary)
                    if !store.study.pending.isEmpty {
                        Text(L("{0} 条记录待同步", "\(store.study.pending.count)")).font(.caption2).foregroundStyle(WatchStyle.mint)
                    }
                    if store.demo { Text(L("模拟器示例 · 不同步")).font(.caption2).foregroundStyle(.orange) }
                }
            }.padding(.horizontal, 4).padding(.bottom, 8)
        }
    }
}

private struct WatchRoundView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dynamicTypeSize) private var typeSize
    let finish: () -> Void
    @State private var detail = false
    @State private var clockTick = Date()
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        let _ = clockTick
        ScrollView {
            VStack(spacing: 6) {
                if let card = store.study.current {
                    if store.study.round.flipped {
                        HStack(alignment: .firstTextBaseline) {
                            Text(card.front).font(.footnote.weight(.semibold)).lineLimit(1)
                            Spacer(minLength: 4)
                            Text("\(store.study.round.done + 1)/\(store.study.round.total)")
                                .font(.caption2).foregroundStyle(WatchStyle.accent)
                        }
                        // A visible excerpt, not an inferred definition. Always offer
                        // the full text and examples in a scrollable detail sheet.
                        Text(card.back.components(separatedBy: "\n\n").first ?? card.back)
                            .font(.footnote).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                        Button(L("查看完整释义")) { detail = true }
                            .font(.caption2).buttonStyle(.plain).foregroundStyle(WatchStyle.accent)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if typeSize.isAccessibilitySize { grades }
                    } else {
                        Text(L("{0} / {1} · 回忆", "\(store.study.round.done + 1)", "\(store.study.round.total)"))
                            .font(.caption2).foregroundStyle(WatchStyle.accent)
                        Text(card.front).font(.system(.title2, design: .rounded, weight: .semibold))
                            .multilineTextAlignment(.center).frame(maxWidth: .infinity, minHeight: 65)
                        Text(L("试着想起它的含义")).font(.caption).foregroundStyle(.secondary)
                        Button(L("查看答案")) { store.flip() }.buttonStyle(WatchPrimaryStyle())
                            .accessibilityIdentifier("flipCard")
                    }
                    Button(L("稍后继续"), action: finish).font(.caption2).buttonStyle(.plain).foregroundStyle(.secondary)
                } else if !store.study.round.queue.isEmpty {
                    Text(L("等待重学")).font(.headline)
                    Text(L("短间隔到期后继续，也可以稍后回来。")).font(.caption)
                    Button(L("稍后继续"), action: finish)
                } else {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 32)).foregroundStyle(WatchStyle.mint)
                    Text(L("又记牢了一点。")).font(.callout.weight(.semibold))
                    HStack(spacing: 18) {
                        VStack { Text("\(store.study.round.done)").font(.title3); Text(L("完成卡片")).font(.caption2) }
                        VStack { Text("\(store.study.round.relearned)").font(.title3); Text(L("重学次数")).font(.caption2) }
                    }.accessibilityElement(children: .combine).accessibilityIdentifier("roundResult")
                    if store.study.round.removed > 0 {
                        Text(L("{0} 张已从学习包移除", "\(store.study.round.removed)")).font(.caption2).foregroundStyle(.secondary)
                    }
                    if !store.study.due().isEmpty {
                        Button(L("再学 {0} 张", "\(min(store.study.due().count, 5))")) { store.start() }.buttonStyle(WatchPrimaryStyle())
                    } else { Text(L("本机卡片已学完")).font(.caption).foregroundStyle(.secondary) }
                    Button(L("结束"), action: finish).accessibilityIdentifier("finishRound")
                }
            }.padding(.horizontal, 4).padding(.bottom, 8)
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { clockTick = $0 }
        .safeAreaInset(edge: .bottom, spacing: 4) {
            if store.study.current != nil && store.study.round.flipped && !typeSize.isAccessibilitySize {
                grades.padding(.horizontal, 4).padding(.bottom, 2).background(.black)
            }
        }
        .sheet(isPresented: $detail) {
            ScrollView {
                if let card = store.study.current {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(card.front).font(.headline).foregroundStyle(WatchStyle.accent)
                        Text(card.back)
                        if let example = card.example { Text(example).italic().foregroundStyle(.secondary) }
                        Button(L("返回评分")) { detail = false }
                    }.font(.body).padding(.horizontal, 4)
                }
            }
        }
    }
    private var grades: some View {
        let now = clockTick
        let previews = store.study.current.flatMap { store.study.progress[$0.id] }.map { FSRSScheduler.preview($0, config: store.study.snapshot?.schedulerConfig ?? SchedulerConfig(), now: now.timeIntervalSince1970 * 1000) } ?? [:]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 7), count: typeSize.isAccessibilitySize ? 1 : 2), spacing: 7) {
            ForEach(ReviewGrade.allCases, id: \.rawValue) { grade in
                Button {
                    if store.review(grade, at: now) { WKInterfaceDevice.current().play(.click) }
                } label: {
                    VStack(spacing: 2) { Text(grade.title); if let next = previews[grade] { Text(StudyEngine.label(next, now: now.timeIntervalSince1970 * 1000)).font(.caption2) } }
                }
                .buttonStyle(WatchGradeStyle(grade: grade))
                .accessibilityIdentifier("grade-\(grade.rawValue)")
            }
        }
    }
}

private struct WatchSyncView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: WatchStore
    @ObservedObject var link: WatchLink
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Picker(L("语言"), selection: $interfaceLanguage) {
                    Text(L("跟随系统")).tag("system")
                    Text("简体中文").tag("zh-Hans")
                    Text("English").tag("en")
                }.pickerStyle(.navigationLink).accessibilityIdentifier("interfaceLanguage")
                    .onChange(of: interfaceLanguage) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
                Image(systemName: link.reachable ? "iphone" : "wifi.slash").foregroundStyle(WatchStyle.mint)
                Text(link.reachable ? L("已连接 iPhone") : L("手机不在，也能学")).font(.headline)
                LabeledContent(L("已缓存"), value: L("{0} 张", "\(store.study.snapshot?.cards.count ?? 0)"))
                LabeledContent(L("等待回传"), value: L("{0} 条", "\(store.study.pending.count)"))
                if let snapshot = store.study.snapshot {
                    Text(L("上次同步 {0}", "\(snapshot.generatedAt.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(AppLanguage.locale)))"))
                        .font(.caption2).foregroundStyle(.secondary)
                    if snapshot.omittedCards > 0 {
                        Text(L("另有 {0} 张留在手机；优先缓存到期卡片。", "\(snapshot.omittedCards)"))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Text(store.demo ? L("模拟器示例，不连接手机。") : localizedMessage(link.status)).font(.caption2).foregroundStyle(.secondary)
                Text(L("记录先保存在手表，手机确认接收后才清除待回传状态。"))
                    .font(.caption2).foregroundStyle(.secondary)
                if let warning = store.widgetWarning { Text(localizedMessage(warning)).font(.caption2).foregroundStyle(.orange) }
                Button(L("重新同步")) { store.synchronize() }.disabled(store.demo)
                Button(L("返回学习")) { dismiss() }.buttonStyle(WatchPrimaryStyle())
            }.padding(.horizontal, 4)
        }
    }
}

private struct WatchPrimaryStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.semibold)).foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(WatchStyle.accent.opacity(configuration.isPressed ? 0.7 : 1), in: Capsule())
    }
}
private struct WatchGradeStyle: ButtonStyle {
    let grade: ReviewGrade
    private var color: Color {
        switch grade { case .again: return .red; case .hard: return .orange; case .good: return WatchStyle.accent; case .easy: return WatchStyle.mint }
    }
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.medium)).foregroundStyle(grade == .good ? .black : color)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(color.opacity(grade == .good ? 1 : 0.18), in: RoundedRectangle(cornerRadius: 17))
            .opacity(configuration.isPressed ? 0.65 : 1)
    }
}
