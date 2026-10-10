import SwiftUI

func aiStatusLabel(_ status: String) -> String {
    ["queued": "排队中", "running": "生成中", "paused": "已暂停", "review": "待审核", "done": "已结束", "failed": "失败", "cancelled": "已取消"][status] ?? status
}
struct TaskQueueView: View {
    @EnvironmentObject private var store: AppStore
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @State private var filter = "review"
    private var visible: [AITask] {
        store.tasks.filter { task in
            switch filter {
            case "review": return task.readyCount > 0
            case "active": return ["queued", "running"].contains(task.status)
            case "attention": return ["failed", "paused"].contains(task.status)
            default: return ["done", "cancelled"].contains(task.status)
            }
        }
    }
    var body: some View {
        let _ = interfaceLanguage
        List {
            Section {
                Picker(L("筛选任务"), selection: $filter) {
                    Text(L("待审核")).tag("review"); Text(L("进行中")).tag("active")
                    Text(L("需处理")).tag("attention"); Text(L("已结束")).tag("finished")
                }.pickerStyle(.segmented)
                Text(L("生成结果需逐张审核，确认后才进入卡片库。")).font(.caption).foregroundStyle(.secondary)
            }
            if let error = store.aiError { Section { Text(localizedMessage(error)).foregroundStyle(.red); Button(L("重新加载")) { Task { await store.loadAITasks() } } } }
            if visible.isEmpty { Text(L("此状态下暂无任务")).foregroundStyle(.secondary) }
            ForEach(visible) { task in
                Section {
                    if task.drafts.isEmpty {
                        NavigationLink { AITaskDetail(taskID: task.id, draftID: "") } label: { Text(L(aiStatusLabel(task.status))) }
                    }
                    ForEach(task.drafts.filter { filter != "review" || $0.status == "ready" }) { draft in
                        NavigationLink { AITaskDetail(taskID: task.id, draftID: draft.id) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(draft.card.front).lineLimit(2).accessibilityIdentifier("ai.draft.\(draft.id)")
                                Text(L(draft.direction == "enToCn" ? "正向卡" : draft.direction == "cnToEn" ? "反向卡" : "新版本")).font(.caption).foregroundStyle(.secondary)
                                Text(L(draft.status == "ready" ? "待审核" : draft.status == "accepted" ? "已入库" : "已丢弃")).font(.caption)
                            }
                        }
                    }
                } header: { HStack { Text(task.word).lineLimit(1); Spacer(); if task.status == "running" { ProgressView() }; Text(L(aiStatusLabel(task.status))) } }
            }
        }.navigationTitle(L("任务队列"))
        .toolbar { Button(L("清理已结束记录")) { Task { do { try await store.clearFinishedAI() } catch { store.error = error.localizedDescription } } } }
    }
}
struct AITaskDetail: View {
    @EnvironmentObject private var store: AppStore
    @State var taskID: String
    @State var draftID: String
    @State private var busy = false
    @State private var error: String?
    @State private var editing: AIDraft?
    @State private var guidance = ""
    private var task: AITask? { store.tasks.first { $0.id == taskID } }
    private var draft: AIDraft? { task?.drafts.first { $0.id == draftID } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let task {
                    Text(task.word).font(.title2).bold()
                    Text(L(aiStatusLabel(task.status)) + " · " + (task.model ?? "")).foregroundStyle(.secondary)
                    if !task.requirements.isEmpty { DisclosureGroup(L("生成要求")) { Text(task.requirements) } }
                    if let warning = task.warning { Text(L(warning)).foregroundStyle(.orange) }
                    if let error = task.error { Text(localizedMessage(error)).foregroundStyle(.red) }
                    if ["queued", "running"].contains(task.status) {
                        HStack {
                            Button(L("暂停")) { action { try await store.controlAI(task.id, status: "paused") } }
                            Button(L("取消生成")) { action { try await store.controlAI(task.id, status: "cancelled") } }
                        }.buttonStyle(.bordered)
                    }
                    if ["failed", "paused", "cancelled"].contains(task.status) { HStack { Button(L("继续 / 重试")) { action { try await store.controlAI(task.id, status: "queued") } }.buttonStyle(.borderedProminent); Button(L("取消生成")) { action { try await store.controlAI(task.id, status: "cancelled") } }.buttonStyle(.bordered) } }
                    if let draft {
                        if task.kind == "replacement", let original = task.expected {
                            DisclosureGroup(L("查看原卡片")) { MarkdownView(content: original.front); MarkdownView(content: original.back) }
                        }
                        face("正面", content: draft.card.front)
                        face("背面", content: draft.card.back)
                        if let example = draft.card.example, !example.isEmpty { face("例句", content: example) }
                        Text(L("牌组") + " · " + store.library.deckPath(draft.card.deckId ?? "default"))
                        Text(L("标签") + " · " + (draft.card.tags ?? []).joined(separator: ", "))
                        if draft.status == "ready" {
                            HStack {
                                Button(L("编辑草稿")) { editing = draft }.buttonStyle(.bordered)
                                Button(L("丢弃草稿"), role: .destructive) { action(advance: true) { try await store.discardAI(taskID: task.id, draftID: draft.id) } }.buttonStyle(.bordered)
                            }
                            Button(L(task.kind == "replacement" ? "确认替换" : "确认入库")) { action(advance: true) { try await store.confirmAI(taskID: task.id, draftID: draft.id) } }.buttonStyle(.borderedProminent).accessibilityIdentifier("ai.confirm")
                            Text(L(task.kind == "replacement" ? "确认后替换原卡，学习进度保留。" : "仅确认当前这张卡片，其他草稿继续等待审核。")).font(.caption).foregroundStyle(.secondary)
                            DisclosureGroup(L("重新生成草稿")) {
                                TextField(L("生成要求"), text: $guidance, axis: .vertical).lineLimit(3...6)
                                Button(L("提交重新生成任务")) { action { try await store.enqueueDraft(taskID: task.id, draftID: draft.id, requirements: guidance); guidance = "" } }
                            }
                        }
                    }
                } else { Text(L("选择任务查看详情")) }
                if let error { Text(localizedMessage(error)).foregroundStyle(.red) }
            }.padding(20).disabled(busy)
        }.navigationTitle(L("审核卡片"))
        .sheet(item: $editing) { draft in AIDraftEditor(taskID: taskID, draft: draft) }
    }
    private func face(_ title: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 10) { Text(L(title)).font(.headline); MarkdownView(content: content) }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func action(advance: Bool = false, _ work: @escaping () async throws -> Void) {
        guard !busy else { return }; busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await work()
                if advance, let next = store.tasks.lazy.flatMap({ task in task.drafts.filter { $0.status == "ready" }.map { (task.id, $0.id) } }).first {
                    taskID = next.0; draftID = next.1
                }
            } catch { self.error = error.localizedDescription }
        }
    }
}
struct AIDraftEditor: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let taskID: String
    @State var draft: AIDraft
    @State private var original: AIDraft?
    @State private var tags = ""
    @State private var saving = false
    @State private var leaving = false
    @State private var preview = false
    @State private var error: String?
    private var dirty: Bool { original.map { $0 != draft || tags != ($0.card.tags ?? []).joined(separator: ", ") } ?? false }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L("牌组"), selection: Binding(get: { draft.card.deckId ?? "default" }, set: { draft.card.deckId = $0 })) { ForEach(store.library.decks) { Text(store.library.deckPath($0.id)).tag($0.id) } }
                    TextField(L("标签（用逗号分隔，清空可移除）"), text: $tags)
                    Toggle(L("卡片预览"), isOn: $preview)
                    Text(L("保存草稿后仍需确认入库。")).font(.caption)
                }
                if preview {
                    Section(L("正面")) { MarkdownView(content: draft.card.front) }
                    Section(L("背面")) { MarkdownView(content: draft.card.back) }
                } else {
                    Section(L("正面")) { MarkdownEditor(text: $draft.card.front) }
                    Section(L("背面")) { MarkdownEditor(text: $draft.card.back) }
                    Section(L("例句")) { TextField(L("例句"), text: Binding(get: { draft.card.example ?? "" }, set: { draft.card.example = $0 }), axis: .vertical) }
                }
                if let error { Text(localizedMessage(error)).foregroundStyle(.red) }
            }.disabled(saving).navigationTitle(L("编辑草稿"))
            .onAppear { if original == nil { original = draft; tags = (draft.card.tags ?? []).joined(separator: ", ") } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("取消")) { if dirty { leaving = true } else { dismiss() } }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(L("保存草稿")) {
                    guard !saving else { return }; saving = true
                    var edited = draft
                    edited.card.tags = Array(Set(tags.components(separatedBy: CharacterSet(charactersIn: ",，\n")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
                    Task {
                        defer { saving = false }
                        do { try await store.saveAIDraft(taskID: taskID, draft: edited); dismiss() }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(saving || !dirty) }
            }
            .interactiveDismissDisabled(dirty || saving)
            .confirmationDialog(L("尚有未保存的修改"), isPresented: $leaving, titleVisibility: .visible) { Button(L("放弃修改"), role: .destructive) { dismiss() }; Button(L("继续编辑"), role: .cancel) {} }
        }
    }
}
