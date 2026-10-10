import UniformTypeIdentifiers
import SwiftUI

@MainActor
final class SettingsDraft: ObservableObject {
    struct Value: Codable, Equatable {
        var limit = 10
        var studyTags: [String]?
        var language = "system"
        var cloud = false
    }
    private struct SavedDraft: Codable { let baseline: Value; let value: Value }
    @Published var value = Value()
    @Published private(set) var baseline = Value()
    private(set) var loaded = false
    var dirty: Bool { loaded && value != baseline }
    private var url: URL?

    func load(store: AppStore, persistence: Persistence) throws {
        guard !loaded, let directory = persistence.store?.directory else { return }
        url = directory.appendingPathComponent("settings-draft.json")
        let current = Value(limit: store.library.newCardsPerDay, studyTags: store.library.studyScope.tags,
                            language: AppLanguage.defaults.string(forKey: AppLanguage.key) ?? "system", cloud: persistence.iCloudEnabled)
        baseline = current; value = current
        if let url, FileManager.default.fileExists(atPath: url.path) {
            let saved = try JSONDecoder().decode(SavedDraft.self, from: Data(contentsOf: url))
            baseline = saved.baseline; value = saved.value
            refresh(current)
        }
        loaded = true
    }
    func refresh(_ current: Value) {
        if value.studyTags == baseline.studyTags { value.studyTags = current.studyTags }
        if value.limit == baseline.limit { value.limit = current.limit }
        if value.language == baseline.language { value.language = current.language }
        if value.cloud == baseline.cloud { value.cloud = current.cloud }
        baseline = current
    }
    func persistDraft() throws {
        guard loaded, let url else { return }
        if dirty {
            try JSONEncoder().encode(SavedDraft(baseline: baseline, value: value))
                .write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } else if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    func discard() throws { value = baseline; try persistDraft() }
    func save(persistence: Persistence) async throws {
        guard (0...100).contains(value.limit) else { throw OpenFormat.failure("每天新词上限必须是 0 到 100 的整数") }
        guard value.studyTags?.isEmpty != true else { throw OpenFormat.failure("请至少选择一个标签") }
        var next = value
        next.studyTags = StudyScope(tags: value.studyTags).tags
        let wasEnabled = persistence.iCloudEnabled
        try await persistence.setICloudEnabled(next.cloud)
        do {
            var event = SyncEvent(kind: .studyConfig, limit: next.limit)
            event.studyScope = StudyScope(tags: next.studyTags)
            try await persistence.append([event])
        } catch {
            try? await persistence.setICloudEnabled(wasEnabled)
            throw error
        }
        AppLanguage.defaults.set(next.language, forKey: AppLanguage.key)
        baseline = next; value = next
        try persistDraft()
    }
}

struct SettingsView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @ObservedObject var draft: SettingsDraft
    var onSave: () -> Void
    @State private var backups = false
    var body: some View {
        let _ = interfaceLanguage
        Form {
            Section { NavigationLink { SchedulerSettingsView() } label: { Label(L("智能复习"), systemImage: "brain") } }
            Section {
                Picker(L("语言"), selection: $draft.value.language) {
                    Text(L("跟随系统")).tag("system")
                    Text("简体中文").tag("zh-Hans")
                    Text("English").tag("en")
                }.accessibilityIdentifier("interfaceLanguage")
            } header: { Text(L("语言")) }
            footer: { Text(L("语言仅应用于本机界面，不改变卡片内容。")) }

            Section {
                Stepper(L("每天新词上限：{0}", "\(draft.value.limit)"), value: $draft.value.limit, in: 0...100)
                    .accessibilityIdentifier("settings.limit")
            } header: { Text(L("学习设置")) }
            footer: { Text(L("控制每天自动引入多少张新词卡。已初始化进度的卡片不受此限制。")) }

            Section {
                Toggle(L("指定标签"), isOn: Binding(get: { draft.value.studyTags != nil }, set: { draft.value.studyTags = $0 ? [] : nil }))
                    .accessibilityIdentifier("settings.tagScope")
                if draft.value.studyTags != nil {
                    StudyTagSelector(cards: store.library.cards, selection: Binding(get: { draft.value.studyTags ?? [] }, set: { draft.value.studyTags = $0 }))
                } else { Text(L("全部卡片")).foregroundStyle(.secondary) }
            } header: { Text(L("默认学习范围")) }
            footer: { Text(L("点击「开始学习」时使用此范围，下次开始生效。")) }

            Section {
                Toggle(L("将数据同步到 iCloud"), isOn: $draft.value.cloud)
                    .accessibilityIdentifier("settings.icloud")
                Label(localizedMessage(persistence.syncStatus), systemImage: "icloud")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("settings.syncStatus")
                if let error = persistence.backupError {
                    Label(L("备份与恢复") + "：" + localizedMessage(error), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red).accessibilityIdentifier("backup.error")
                }
                if persistence.iCloudEnabled {
                    if persistence.needsICloudAuthorization {
                        Button(L("授权固定 iCloud 目录"), action: onSave)
                    } else {
                        Button(L("立即同步")) { Task { await persistence.synchronize(fullCheck: true) } }
                    }
                }
                DisclosureGroup(L("同步说明")) {
                    Text(L("固定目录：iCloud Drive / VibeWordSync-v1"))
                    Text(L("首次启用时，请授权 iCloud Drive 根目录下的 VibeWordSync-v1 文件夹；不存在时请先创建同名文件夹。"))
                    Text(L("卡片、进度和文字／画图模型配置一起同步，包含 API 地址、模型名和 API Key；API Key 以明文保存在同步文件中。"))
                }
                .font(.subheadline)
            } header: { Text("iCloud") }
            footer: { Text(L("关闭后仅使用本地数据，保留已有的 iCloud 文件。")) }

            Section {
                Button(L("备份与恢复"), systemImage: "externaldrive") { backups = true }
                    .accessibilityIdentifier("settings.backups")
            }
            WatchSyncSection(sync: store.watchSync)

            Section {
                modelSummary(L("AI 模型配置"), symbol: "sparkles", config: store.library.llm, identifier: "settings.textModel")
                modelSummary(L("画图模型配置（可选）"), symbol: "photo", config: store.library.image, identifier: "settings.imageModel")
            } header: { Text(L("模型配置")) }
            footer: { Text(L("模型配置仅供查看，请在桌面端修改后通过 iCloud 同步。")) }
        }
        .navigationTitle(L("设置"))
        .sheet(isPresented: $backups) { NavigationStack { StudyCenterView(section: 2) }.modifier(StoreErrorAlert()) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if draft.dirty {
                VStack(spacing: 8) {
                    Text(L("有未保存的配置"))
                        .font(.caption).foregroundStyle(.secondary)
                    Button(action: onSave) {
                        Text(L("保存"))
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent).tint(.indigo)
                    .accessibilityIdentifier("settings.save")
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(.regularMaterial)
            }
        }
    }

    private func modelSummary(_ title: String, symbol: String, config: APIConfig, identifier: String) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 16) {
                configValue(L("API 地址"), value: config.baseURL.isEmpty ? L("未配置") : config.baseURL)
                configValue(L("模型名称"), value: config.model.isEmpty ? L("未配置") : config.model)
                configValue("API Key", value: config.apiKey.isEmpty ? L("未配置") : "••••••••")
            }
            .padding(.vertical, 8)
        } label: {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).foregroundStyle(.primary)
                    Text(config.model.isEmpty ? L("未配置") : config.model)
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } icon: { Image(systemName: symbol).foregroundStyle(.indigo) }
        }
        .accessibilityIdentifier(identifier)
    }

    private func configValue(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WatchSyncSection: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @ObservedObject var sync: PhoneWatchSync
    var body: some View {
        let _ = interfaceLanguage
        Section {
            Label(localizedMessage(sync.status), systemImage: "applewatch")
                .font(.subheadline).foregroundStyle(.secondary)
            Button(L("更新手表学习包")) { sync.refresh() }
        } header: { Text("Apple Watch") }
        footer: {
            Text(L("手表缓存最多 500 张已引入的卡片，支持离线复习。仅发送文字和学习进度，不发送图片或 API 配置。首次同步请打开手表应用。"))
        }
    }
}


struct SettingsSheet: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @Environment(\.dismiss) private var dismiss
    @StateObject private var draft = SettingsDraft()
    @State private var confirming = false
    @State private var authorizing = false
    @State private var leaveAfterSave = false

    var body: some View {
        NavigationStack {
            SettingsView(draft: draft, onSave: { leaveAfterSave = false; save() })
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L("关闭")) { if draft.dirty { confirming = true } else { dismiss() } }
                            .accessibilityIdentifier("settings.close")
                    }
                }
        }
        .interactiveDismissDisabled(draft.dirty)
        .onAppear {
            do { try draft.load(store: store, persistence: persistence) }
            catch { store.error = error.localizedDescription }
        }
        .onChange(of: draft.value) { _, _ in
            do { try draft.persistDraft() } catch { store.error = error.localizedDescription }
        }
        .onChange(of: store.library.studyScope) { _, _ in refresh() }
        .onChange(of: store.library.newCardsPerDay) { _, _ in refresh() }
        .alert(L("有未保存的配置"), isPresented: $confirming) {
            Button(L("保存并离开")) { leaveAfterSave = true; save() }
            Button(L("放弃修改"), role: .destructive) {
                do { try draft.discard(); dismiss() } catch { store.error = error.localizedDescription }
            }
            Button(L("继续编辑"), role: .cancel) { }
        } message: { Text(L("离开前要保存配置吗？")) }
        .fileImporter(isPresented: $authorizing, allowedContentTypes: [.folder]) { result in
            Task { do { try await persistence.authorizeICloudFolder(result.get()); save() }
            catch { leaveAfterSave = false; store.error = error.localizedDescription } }
        }
        .modifier(StoreErrorAlert())
    }
    private func refresh() {
        guard draft.loaded else { return }
        draft.refresh(.init(limit: store.library.newCardsPerDay, studyTags: store.library.studyScope.tags,
                            language: AppLanguage.defaults.string(forKey: AppLanguage.key) ?? "system", cloud: persistence.iCloudEnabled))
    }
    private func save() {
        finishTextInput()
        if draft.value.cloud && persistence.needsICloudAuthorization { authorizing = true; return }
        Task {
            do { try await draft.save(persistence: persistence); if leaveAfterSave { dismiss() } }
            catch { leaveAfterSave = false; store.error = error.localizedDescription }
        }
    }
}

struct SchedulerSettingsView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @State private var config = SchedulerConfig()
    @State private var baseline = SchedulerConfig()
    @State private var learning = "1 10"
    @State private var relearning = "10"
    @State private var busy = false
    @State private var error = ""
    @State private var message = ""
    @State private var result: OptimizationResult?
    @State private var confirm = false
    @State private var trainingTask: Task<OptimizationResult, Error>?
    private var eligible: [ReviewRecord] { store.library.reviews.filter { !$0.undone && $0.before.lastReviewedAt != nil && FSRSScheduler.elapsed($0.before.lastReviewedAt, $0.timestamp) > 0 } }
    private var states: [SchedulingState] { store.library.progress.values.filter { store.library.controls[$0.cardId]?.suspended != true } }
    private var projection: [SchedulingState] { FSRSScheduler.projection(states, history: store.library.reviews, config: config) }
    private var beforeCount: Int { states.filter { $0.lastReviewedAt != nil && $0.learningDue == nil && $0.due <= Day.adding(7, to: Day.key()) }.count }
    private var afterCount: Int { projection.filter { $0.due <= Day.adding(7, to: Day.key()) }.count }
    private var dirty: Bool { config != baseline || learning != steps(baseline.learningSteps) || relearning != steps(baseline.relearningSteps) }
    private var canOptimize: Bool { eligible.count >= 200 && eligible.filter { $0.quality < 3 }.count >= 20 && eligible.filter { $0.quality >= 3 }.count >= 20 }
    private func steps(_ values: [Double]) -> String { values.map { $0.formatted(.number.precision(.fractionLength(0...1))) }.joined(separator: " ") }
    private func load() { config = store.library.schedulerConfig; baseline = config; learning = steps(config.learningSteps); relearning = steps(config.relearningSteps) }
    var body: some View {
        Form {
            Section {
                Text("FSRS-6").font(.caption.bold()).foregroundStyle(.purple)
                Text(L("让复习适合你的记忆")).font(.title2.bold())
                Text(L("根据每次回忆的难易和间隔，安排下一次见面。")).font(.subheadline).foregroundStyle(.secondary)
                LabeledContent(L("目标记忆保持率"), value: "\(Int((config.retention * 100).rounded()))%")
                Slider(value: $config.retention, in: 0.7...0.97, step: 0.01).tint(.purple).accessibilityLabel(L("目标记忆保持率"))
                Text(L("90% 是均衡起点。提高保持率会缩短间隔，增加复习次数。")).font(.caption).foregroundStyle(.secondary)
            }
            Section {
                LabeledContent(L("未来 7 天已安排"), value: "\(beforeCount)")
                LabeledContent(L("按当前保持率重排"), value: "\(afterCount)")
            } footer: { Text(L("仅估算已学卡片的下一次到期，包含逾期；不预测之后的重复评分。")) }
            Section {
                TextField(L("新卡步骤（分钟）"), text: $learning).keyboardType(.numbersAndPunctuation)
                TextField(L("重学步骤（分钟）"), text: $relearning).keyboardType(.numbersAndPunctuation)
                TextField(L("最大间隔（天）"), value: $config.maximumInterval, format: .number).keyboardType(.numberPad)
                Text(L("用空格分隔递增的分钟数。困难表示费力想起；忘记请选重来。")).font(.caption).foregroundStyle(.secondary)
                Button(L("应用复习设置")) { save() }.disabled(!dirty)
                Button(L("恢复默认参数")) { config = SchedulerConfig(); learning = "1 10"; relearning = "10"; result = nil }
            } header: { Text(L("学习步骤与间隔")) }
            Section {
                Text(baseline.optimizedAt == nil ? L("默认参数") : L("个人参数"))
                Text(L("跨日复习 {0} 次 · 遗忘 {1} 次", String(eligible.count), String(eligible.filter { $0.quality < 3 }.count)))
                Button(L("优化个人参数")) { optimize() }.disabled(!canOptimize || dirty)
                if !canOptimize { Text(L("需要至少 200 次跨日复习，其中至少 20 次遗忘和 20 次记住")).font(.caption).foregroundStyle(.secondary) }
                if let result {
                    Text(result.accepted ? L("找到更适合你的参数") : L("当前参数表现更稳，继续使用"))
                    Text(L("验证记录 {0} 次 · 预测误差 {1} → {2}（越低越好）", String(result.validation), String(format: "%.4f", result.baselineLoss), String(format: "%.4f", result.candidateLoss))).font(.caption)
                    if result.accepted { Button(L("应用优化结果")) { save(result.config) }.disabled(dirty) }
                }
            } header: { Text(L("根据我的记录优化")) } footer: { Text(L("在本机训练，使用较晚的记录独立验证；改善后再应用。")) }
            Section {
                Button(L("预览并重新安排")) { confirm = true }.disabled(dirty)
            } footer: { Text(L("应用设置不会改动现有到期日。需要立即重排时，会先自动备份；暂停卡片和学习中的卡片不参与。")) }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            if !message.isEmpty { Text(message).foregroundStyle(.green) }
        }
        .disabled(busy)
        .navigationTitle(L("智能复习"))
        .overlay { if busy { ProgressView(L("处理中…")).padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
        .onAppear { load() }
        .onDisappear { trainingTask?.cancel() }
        .confirmationDialog(L("重新安排已学卡片"), isPresented: $confirm, titleVisibility: .visible) {
            Button(L("备份并重新安排")) { reschedule() }
            Button(L("取消"), role: .cancel) {}
        } message: { Text(L("将更新 {0} 张卡片，未来 7 天到期量由 {1} 张变为 {2} 张。", String(projection.count), String(beforeCount), String(afterCount))) }
    }
    private func save(_ candidate: SchedulerConfig? = nil) {
        var next = candidate ?? config
        next.id = UUID().uuidString
        next.learningSteps = learning.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "，" }).map { Double($0) ?? .nan }
        next.relearningSteps = relearning.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "，" }).map { Double($0) ?? .nan }
        do { try next.validate() } catch { self.error = error.localizedDescription; return }
        let saved = next, expected = baseline.id
        busy = true; error = ""
        Task { do {
            _ = try await persistence.commit { library in
                guard library.schedulerConfig.id == expected else { throw OpenFormat.failure("学习状态已变化，请重新检查") }
                var event = SyncEvent(kind: .fsrsConfig); event.schedulerConfig = saved; return [event]
            }
            load(); result = nil; message = L("已应用，下一次评分开始使用；现有到期日保持不变。")
        } catch { self.error = error.localizedDescription }; busy = false }
    }
    private func optimize() {
        let records = store.library.reviews, saved = baseline
        busy = true; error = ""; result = nil
        let task = Task.detached(priority: .utility) { try FSRSScheduler.optimize(records, config: saved) }
        trainingTask = task
        Task { do { result = try await task.value } catch { self.error = error.localizedDescription }; busy = false; trainingTask = nil }
    }
    private func reschedule() {
        busy = true; error = ""
        let expected = baseline.id
        Task { do { _ = try await persistence.rescheduleFSRS(expected); load(); message = L("已备份并重新安排") } catch { self.error = error.localizedDescription }; busy = false }
    }
}
