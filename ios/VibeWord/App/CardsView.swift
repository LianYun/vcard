import SwiftUI

struct HeatmapView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    let stats: [String: DailyStat]
    @State private var selected: String?
    private var first: String { Day.adding(-(Day.calendar.component(.weekday, from: Date()) - 1) - 25 * 7, to: Day.key()) }
    private var recent: [DailyStat] { stats.filter { $0.key >= first && $0.key <= Day.key() }.map(\.value) }
    private var streak: Int {
        var n = 0
        while Day.adding(-n, to: Day.key()) >= first && (stats[Day.adding(-n, to: Day.key())]?.total ?? 0) > 0 { n += 1 }
        return n
    }
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        VStack(alignment: .leading, spacing: 12) {
            Text(L("学习记录")).font(.headline)
            Text(L("连续 {0} 天 · 累计 {1} 天\n复习 {2} · 新增 {3}", "\(streak)", "\(recent.filter { $0.total > 0 }.count)", "\(recent.reduce(0) { $0 + $1.reviewed })", "\(recent.reduce(0) { $0 + $1.added })"))
                .font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                HStack(spacing: 3) {
                    ForEach(0..<26) { week in
                        VStack(spacing: 3) {
                            ForEach(0..<7) { day in
                                let key = Day.adding(week * 7 + day, to: first)
                                let count = stats[key]?.total ?? 0
                                Button { selected = key } label: {
                                    RoundedRectangle(cornerRadius: 2).fill(color(count)).frame(width: 11, height: 11)
                                }.buttonStyle(.plain).opacity(key > Day.key() ? 0 : 1)
                                    .disabled(key > Day.key()).accessibilityLabel(L("{0}，{1} 次活动", "\(key)", "\(count)"))
                            }
                        }
                    }
                }
            }
            if let selected { Text(L("{0} · 复习 {1} · 新增 {2}", "\(selected)", "\(stats[selected]?.reviewed ?? 0)", "\(stats[selected]?.added ?? 0)")).font(.caption) }
        }.padding(.vertical, 8)
    }
    private func color(_ n: Int) -> Color { n == 0 ? Color.gray.opacity(0.15) : Color.green.opacity(n <= 2 ? 0.3 : n <= 5 ? 0.5 : n <= 9 ? 0.75 : 1) }
}

// Local presentation state only: no calls to AppStore.startSession, review, or persistence.
struct QuickLearningView: View {
    @EnvironmentObject private var store: AppStore
    @State private var filter = StudyFilter.all
    @State private var limit = 20
    let cards: [Card]
    @Environment(\.dismiss) private var dismiss
    @State private var all = true
    @State private var selected = Set<String>()
    @State private var session: [Card]?
    @State private var index = 0
    @State private var flipped = false
    private var tags: [String] { Array(Set(cards.flatMap { $0.tags ?? [] })).sorted() }
    private var matching: [Card] {
        cards.filter { card in (all || selected.contains { tag in
            tag.isEmpty ? (card.tags ?? []).isEmpty : (card.tags ?? []).contains(tag)
        }) && filter.matches(card, library: store.library) }
    }
    var body: some View {
        Group {
            if let session {
                VStack(spacing: 16) {
                    Text("\(index + 1) / \(session.count)").monospacedDigit()
                        .accessibilityIdentifier("quick.position")
                    GeometryReader { geometry in
                        TabView(selection: $index) {
                            ForEach(session.indices, id: \.self) { position in
                                ScrollView {
                                    StudyCardFace(card: session[position], flipped: position == index && flipped, minHeight: geometry.size.height)
                                        .contentShape(Rectangle())
                                        .onTapGesture { flipped.toggle() }
                                        .accessibilityAction { flipped.toggle() }
                                        .accessibilityIdentifier("quick.card")
                                        .accessibilityValue(position == index && flipped ? session[position].back : session[position].front)
                                }.tag(position)
                            }
                        }
                        .tabViewStyle(.page(indexDisplayMode: .never))
                        .onChange(of: index) { _, _ in flipped = false }
                    }
                    Text(L("点击卡片翻面，左右滑动切换卡片")).font(.footnote).foregroundStyle(.secondary)
                    Text(L("不记录掌握程度，不影响学习进度和每日额度")).font(.caption).foregroundStyle(.secondary)
                }.padding(20)
                    .accessibilityAction(named: Text(L("上一张"))) { move(-1) }
                    .accessibilityAction(named: Text(L("下一张"))) { move(1) }
            } else {
                Form {
                    Section {
                        Picker(L("专项范围"), selection: $filter) { ForEach(StudyFilter.allCases.filter { $0 != .suspended }, id: \.self) { Text(L($0.rawValue)).tag($0) } }
                        Picker(L("每轮数量"), selection: $limit) { ForEach([10,20,50], id: \.self) { Text("\($0)").tag($0) } }
                    }
                    Section {
                        Toggle(L("全部卡片"), isOn: Binding(get: { all }, set: { all = $0; selected.removeAll() }))
                        ForEach([""] + tags, id: \.self) { tag in
                            Toggle(tag.isEmpty ? L("未打标签") : tag, isOn: Binding(
                                get: { !all && selected.contains(tag) },
                                set: { enabled in all = false; if enabled { selected.insert(tag) } else { selected.remove(tag) } }
                            ))
                        }
                    } header: { Text(L("选择学习范围")) }
                    footer: { Text(L("可多选标签，包含任一所选标签的卡片都会加入")) }
                    Section {
                        Text(L("共 {0} 张卡片", "\(matching.count)"))
                        Button(L("开始快速学习")) { session = Array(shuffleStudyCards(matching).prefix(limit)); index = 0; flipped = false }
                            .disabled(matching.isEmpty).accessibilityIdentifier("quick.start")
                    }
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(L("翻卡浏览")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button(L("返回我的卡片")) { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if session != nil { Button(L("重新选择标签")) { session = nil; flipped = false } }
            }
        }
    }
    private func move(_ delta: Int) {
        guard let session, session.indices.contains(index + delta) else { return }
        index += delta; flipped = false
    }
}

struct StudyCenterView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var days = 1
    @State private var replacing = false
    var section = 0
    @State private var studying = false
    @State private var backups: [String] = []
    @State private var restore: String?
    @State private var restoreCount = 0
    private var future: [Card] { StudyEngine.ahead(cards: store.library.cards, progress: store.library.progress, controls: store.library.controls, days: days) }
    private var reviews: [ReviewRecord] { store.library.reviews.filter { !$0.undone && $0.day >= Day.adding(-6, to: Day.key()) } }
    var body: some View {
        List {
            if section == 0 { aheadSection }
            if section == 1 { statsSection }
            if section == 2 { backupSection }
        }
        .navigationTitle(L(section == 0 ? "提前复习" : section == 1 ? "学习记录" : "备份与恢复"))
        .toolbar { Button(L("关闭")) { dismiss() } }
        .onAppear { loadBackups() }
        .confirmationDialog(L("开始新的复习？"), isPresented: $replacing, titleVisibility: .visible) {
            Button(L("开始新的复习")) { beginAhead() }
        } message: { Text(L("已保存的评分会保留，当前未完成队列将重新安排。")) }
        .fullScreenCover(isPresented: $studying) { NavigationStack { StudyView() }.environmentObject(store) }
        .alert(L("确认恢复"), isPresented: Binding(get: { restore != nil }, set: { if !$0 { restore = nil } })) {
            Button(L("取消"), role: .cancel) { restore = nil }
            Button(L("备份当前数据并恢复"), role: .destructive) { Task {
                if let name = restore {
                    do { _ = try await store.persistence.perform { try $0.append([$0.restoreEvent(name)]) }; store.queue = []; store.lastReviewID = nil; store.persistSession(); loadBackups() }
                    catch { store.error = error.localizedDescription }
                }
                restore = nil
             } }
        } message: { Text("\(restoreCount) \(L("张卡片"))\n\(L("当前数据将回到此备份。Mac 和 iPhone 的恢复会同步到其他设备，请先同步所有设备，再恢复。"))") }
    }
    private var aheadSection: some View {
        Section {
            Text(L("提前学一点，为接下来留出时间")).font(.headline)
            Text(L("学习明天起未来 1–5 天到期的已学卡片，不占新卡额度。评分计入正式复习，按今天更新排程。")).font(.footnote).foregroundStyle(.secondary)
            Picker(L("提前学习天数"), selection: $days) { ForEach(1...5, id: \.self) { Text("\($0) \(L("天"))").tag($0) } }.pickerStyle(.segmented)
            Text("\(Day.adding(1, to: Day.key())) — \(Day.adding(days, to: Day.key()))").font(.caption).foregroundStyle(.secondary)
            Text("\(future.count) \(L("张可提前学习"))").font(.title2.bold()).foregroundStyle(.indigo)
            Button(L("开始提前学习")) { if store.queue.isEmpty { beginAhead() } else { replacing = true } }.buttonStyle(.borderedProminent).disabled(future.isEmpty)
            if future.isEmpty { Text(L("这个时间范围内没有待复习卡片，可以换一个天数。")).foregroundStyle(.secondary) }
            ForEach(Array(future.prefix(5))) { card in HStack { Text(card.front).lineLimit(1); Spacer(); Text(store.library.progress[card.id]?.due ?? "").font(.caption) } }
        }
    }
    private var statsSection: some View {
        Section {
            HeatmapView(stats: store.library.stats)
            let today = reviews.filter { $0.day == Day.key() }
            LabeledContent(L("今日学习张数"), value: "\(Set(today.map(\.cardId)).count)")
            LabeledContent(L("今日评分次数"), value: "\(today.count)")
            LabeledContent(L("近 7 天遗忘率"), value: reviews.isEmpty ? "—" : "\(Int(Double(reviews.filter { $0.quality < 3 }.count) / Double(reviews.count) * 100))%")
            Text(L("评分明细从本次升级起记录；旧版累计活动仍保留在学习记录中。")).font(.caption).foregroundStyle(.secondary)
            ForEach(ReviewGrade.allCases, id: \.rawValue) { grade in LabeledContent(grade.title, value: "\(reviews.filter { $0.quality == grade.rawValue }.count)") }
            Text(L("未来 7 天到期")).font(.headline)
            ForEach(1...7, id: \.self) { offset in
                let day = Day.adding(offset, to: Day.key())
                let count = store.library.cards.filter { (store.library.controls[$0.id]?.available(on: day) ?? true) && store.library.progress[$0.id]?.lastReviewedAt != nil && store.library.progress[$0.id]?.due == day }.count
                HStack { Text(String(day.suffix(5))); ProgressView(value: Double(count), total: Double(max(1,store.library.cards.count))); Text("\(count)") }
            }
            Text(L("根据当前排程汇总，后续评分会改变到期量。")).font(.caption).foregroundStyle(.secondary)
            Text(L("最近反复忘记的卡片")).font(.headline)
            ForEach(store.library.cards.filter { StudyFilter.forgotten.matches($0, library: store.library) }.prefix(10)) { card in
                LabeledContent(card.front, value: "\(reviews.filter { $0.cardId == card.id && $0.quality < 3 }.count) \(L("次"))")
            }
        }
    }
    private var backupSection: some View {
        Section {
            Text(L("自动保留最近 14 个有学习活动日期的备份。备份在本机，包含学习记录与配置；恢复前会再保存当前版本。")).font(.footnote).foregroundStyle(.secondary)
            Button(L("立即备份")) {
                Task { do { _ = try await store.persistence.createBackup(); loadBackups() }
                catch { store.error = error.localizedDescription } }
            }
            ForEach(backups, id: \.self) { name in
                Button {
                    Task { do {
                        restoreCount = try await store.persistence.perform { Library(events: try $0.backupEvents(name)).cards.count }; restore = name
                    } catch { store.error = error.localizedDescription } }
                } label: { VStack(alignment: .leading) { Text(name).font(.caption).lineLimit(2); Text(L("预览并恢复")) } }
            }
            if backups.isEmpty { Text(L("尚无备份。")) }
        }
    }
    private func beginAhead() { Task { if await store.startSession(ahead: days) { studying = true } } }
    private func loadBackups() {
        Task { do { backups = try await store.persistence.perform { try $0.backupFiles().map(\.lastPathComponent) } }
        catch { store.error = error.localizedDescription } }
    }
}

/// Shared by saved defaults and the temporary study filter.
struct StudyTagSelector: View {
    let cards: [Card]
    @Binding var selection: [String]
    @State private var query = ""
    private var tags: [String] { Array(Set([""] + cards.flatMap { $0.tags ?? [] } + selection)).sorted() }
    var body: some View {
        TextField(L("搜索标签"), text: $query).accessibilityIdentifier("tags.search")
        ForEach(tags.filter { query.isEmpty || ($0.isEmpty ? L("未打标签") : $0).localizedCaseInsensitiveContains(query) }, id: \.self) { tag in
            Toggle(isOn: Binding(get: { selection.contains(tag) }, set: { checked in
                selection = StudyScope(tags: checked ? selection + [tag] : selection.filter { $0 != tag }).tags ?? []
            })) {
                HStack {
                    Text(tag.isEmpty ? L("未打标签") : tag)
                    Spacer()
                    Text("\(cards.filter(StudyScope(tags: [tag]).matches).count)").foregroundStyle(.secondary)
                }
            }.accessibilityIdentifier("tags.option.\(tag.isEmpty ? "untagged" : tag)")
        }
        Text(L("匹配任意一个所选标签即可，同一卡片只学习一次。"))
            .font(.caption).foregroundStyle(.secondary)
        Text(L("已选择 {0} 个标签，包含 {1} 张卡片", "\(selection.count)", "\(cards.filter(StudyScope(tags: selection).matches).count)"))
            .font(.subheadline).accessibilityIdentifier("tags.summary")
        if !selection.isEmpty { Button(L("清空")) { selection = [] }.accessibilityIdentifier("tags.clear") }
        else { Text(L("请至少选择一个标签")).font(.caption).foregroundStyle(.secondary) }
    }
}

struct TagStudyView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var selection: [String] = []
    @State private var initialized = false
    @State private var studying = false
    @State private var all = false
    @State private var saveDefault = false
    @State private var replacing = false
    var body: some View {
        let preview = StudySelection.make(library: store.library, scope: StudyScope(tags: all ? nil : selection))
        let count = preview.reviews.count + preview.fresh.count
        Form {
            Section {
                Toggle(L("全部卡片"), isOn: $all).accessibilityIdentifier("tags.all")
                if !all { StudyTagSelector(cards: store.library.cards, selection: $selection) }
                Toggle(L("设为默认范围"), isOn: $saveDefault)
            } footer: { Text(L(saveDefault ? "开始后将保存为默认学习范围。" : "仅用于本次学习，不修改默认学习范围。")) }
            Section {
                Text(L("本次可学：待复习 {0} 张 · 新卡 {1} 张", "\(preview.reviews.count)", "\(preview.fresh.count)"))
                    .accessibilityIdentifier("tags.preview")
                Text(L("今日新卡剩余额度：{0} 张", "\(preview.budget)"))
                if count == 0 { Text(L(!all && selection.isEmpty ? "请至少选择一个标签" : preview.emptyReason)).foregroundStyle(.secondary) }
                Button(L("开始学习 · {0} 张", "\(count)")) {
                    if store.queue.isEmpty { start() } else { replacing = true }
                }.disabled(count == 0).accessibilityIdentifier("tags.start")
            }
        }
        .navigationTitle(L("本次复习范围"))
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("关闭")) { dismiss() } } }
        .onAppear {
            if !initialized { selection = store.library.studyScope.tags ?? []; all = store.library.studyScope.tags == nil; initialized = true }
        }
        .confirmationDialog(L("开始新的复习？"), isPresented: $replacing, titleVisibility: .visible) {
            Button(L("开始新的复习")) { start() }
        } message: { Text(L("已保存的评分会保留，当前未完成队列将重新安排。")) }
        .fullScreenCover(isPresented: $studying) {
            NavigationStack { StudyView(exitTitle: "返回复习范围") }
                .environmentObject(store)
                .alert(L("操作未完成"), isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                    Button(L("知道了")) { store.error = nil }
                } message: { Text(localizedMessage(store.error ?? "")) }
        }
        .alert(L("操作未完成"), isPresented: Binding(get: { !studying && store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button(L("知道了")) { store.error = nil }
        } message: { Text(localizedMessage(store.error ?? "")) }
    }
    private func start() { Task {
        let scope = StudyScope(tags: all ? nil : selection)
        if saveDefault {
            var event = SyncEvent(kind: .studyConfig, limit: store.library.newCardsPerDay)
            event.studyScope = scope
            guard await store.save([event]) else { return }
        }
        if await store.startSession(scope: scope) { studying = true }
    } }

}
