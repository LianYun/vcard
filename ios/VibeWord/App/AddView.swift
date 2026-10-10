import SwiftUI

struct AddView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    let jump: (String) -> Void
    var onSettings: () -> Void = {}
    @State private var front = ""
    @State private var feedback = ""
    @State private var creating = false
    @State private var submitting = false
    private var word: String { front.trimmingCharacters(in: .whitespacesAndNewlines) }
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        Form {
            Section { Button(L("创建卡片"), systemImage: "plus.rectangle") { creating = true } }
            Section(L("AI 添加")) {
                TextField(L("单词 / 正面"), text: $front, axis: .vertical).textInputAutocapitalization(.never)
                    .accessibilityIdentifier("add.front")
                Button(L("AI 生成（后台）"), systemImage: "sparkles") {
                    guard !submitting else { return }
                    submitting = true
                    Task {
                        defer { submitting = false }
                        do { try await store.enqueue(word); feedback = L("已加入任务队列"); clear() }
                        catch { store.error = error.localizedDescription }
                    }
                }.disabled(submitting || word.isEmpty || !store.library.llm.isConfigured)
                    .accessibilityIdentifier("add.generate")
                if !store.library.llm.isConfigured {
                    Text(L("请先在桌面端配置 AI 模型，并通过 iCloud 同步到此设备。")).font(.caption).foregroundStyle(.secondary)
                    Button(L("打开同步设置"), action: onSettings)
                }
                if !feedback.isEmpty { Text(localizedMessage(feedback)).font(.caption).foregroundStyle(.green) }
            }
            Section { NavigationLink(L("查看任务队列")) { TaskQueueView() } }
            Section { Text(L("切换页面后会继续生成。iOS 在应用进入后台后可能暂停网络任务；再次打开可继续或重试。")).font(.caption).foregroundStyle(.secondary) }
        }.navigationTitle(L("添加卡片"))
        .sheet(isPresented: $creating) { EditCardView(card: Card(front: "", back: ""), creating: true) }
        .modifier(KeyboardDoneModifier())

    }
    private func clear() { finishTextInput(); front = "" }
}

struct EditCardView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State var card: Card
    var creating = false
    @State private var original: Card?
    @State private var tagsText = ""
    @State private var initialTags = ""
    @State private var noteFields: [String: String] = [:]
    @State private var initialFields: [String: String] = [:]
    @State private var editError: String?
    @State private var saving = false
    @State private var leaving = false
    @State private var preview = false
    @State private var back = false
    @State private var continueAdding = true
    @State private var savedNotice = false
    private var dirty: Bool { original.map { card != $0 || tagsText != initialTags || noteFields != initialFields } ?? false }
    private var previewError: String? {
        guard card.anki != nil else { return nil }
        do { _ = try store.library.editAnkiEvents(id: card.id, fields: noteFields); return nil }
        catch { return error.localizedDescription }
    }
    private var previewEvents: [SyncEvent] { (try? store.library.editAnkiEvents(id: card.id, fields: noteFields)) ?? [] }
    private func close() { if dirty { leaving = true } else { dismiss() } }
    var body: some View {
        let _ = interfaceLanguage
        NavigationStack {
            Form {
                Section {
                    Text(L(card.anki == nil ? "问答卡" : "Anki 模板卡"))
                    Picker(L("牌组"), selection: Binding(get: { card.deckId ?? "default" }, set: { card.deckId = $0 })) {
                        ForEach(store.library.decks) { deck in Text(store.library.deckPath(deck.id)).tag(deck.id) }
                    }
                    TextField(L("标签（用逗号分隔，清空可移除）"), text: $tagsText).accessibilityIdentifier("edit.tags")
                    Picker(L("编辑模式"), selection: $preview) { Text(L("编辑")).tag(false); Text(L("卡片预览")).tag(true) }.pickerStyle(.segmented)
                }
                if preview {
                    Section(L("卡片预览")) {
                        Picker(L("卡片预览"), selection: $back) { Text(L("正面")).tag(false); Text(L("背面")).tag(true) }.pickerStyle(.segmented)
                        if card.anki != nil {
                            let events = previewEvents
                            Text(L("新增 {0} 张 · 删除 {1} 张", "\(events.filter { $0.kind == .add }.count)", "\(events.filter { $0.kind == .delete }.count)"))
                            ForEach(events.compactMap(\.card)) { item in CardContentView(card: item, back: back) }
                        } else { CardContentView(card: card, back: back); if back, let example = card.example, !example.isEmpty { Text(example) } }
                    }
                } else if card.anki != nil {
                    Section(L("编辑 Anki 笔记")) {
                        Text(L("修改会更新同一笔记的所有卡片。新增 Cloze 编号会创建新卡，移除编号会删除对应卡片；保留编号的学习进度不变。"))
                        ForEach(noteFields.keys.sorted().filter { !["Tags", "Deck", "Subdeck", "Type", "Card"].contains($0) }, id: \.self) { key in
                            TextField(key, text: Binding(get: { noteFields[key] ?? "" }, set: { noteFields[key] = $0 }), axis: .vertical)
                        }
                    }
                } else {
                    Section(L("正面")) { MarkdownEditor(text: $card.front) }
                    Section(L("背面")) { MarkdownEditor(text: $card.back) }
                    Section(L("例句（可选）")) { TextField(L("输入例句或补充说明"), text: Binding(get: { card.example ?? "" }, set: { card.example = $0 }), axis: .vertical) }
                }
                if creating { Section { Toggle(L("创建后继续添加"), isOn: $continueAdding) } }
                if savedNotice { Section { Text(L("卡片已创建，可以继续添加。")).foregroundStyle(.green) } }
                if let previewError { Section { Text(localizedMessage(previewError)).foregroundStyle(.red) } }
                if let editError { Section { Text(localizedMessage(editError)).foregroundStyle(.red) } }
            }
            .disabled(saving)
            .navigationTitle(L(creating ? "创建卡片" : "编辑卡片"))
            .onAppear {
                guard original == nil else { return }
                if !creating {
                    guard let latest = store.library.cards.first(where: { $0.id == card.id }) else { editError = "卡片已删除，请刷新"; return }
                    card = latest
                }
                original = card
                noteFields = card.anki?.fields ?? [:]; initialFields = noteFields
                tagsText = (card.tags ?? []).joined(separator: ", "); initialTags = tagsText
            }
            .modifier(KeyboardDoneModifier())
            .interactiveDismissDisabled(dirty || saving)
            .confirmationDialog(L("尚有未保存的修改"), isPresented: $leaving, titleVisibility: .visible) {
                Button(L("放弃修改"), role: .destructive) { dismiss() }
                Button(L("继续编辑"), role: .cancel) { }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("取消"), action: close).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L(saving ? "保存中…" : creating ? "创建卡片" : "保存")) {
                        guard !saving, let expected = original else { return }
                        saving = true; editError = nil
                        var draft = card
                        draft.tags = Array(Set(tagsText.components(separatedBy: CharacterSet(charactersIn: ",，\n")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
                        Task {
                            defer { saving = false }
                            do {
                                if creating {
                                    draft.front = draft.front.trimmingCharacters(in: .whitespacesAndNewlines)
                                    draft.back = draft.back.trimmingCharacters(in: .whitespacesAndNewlines)
                                    if await store.add([draft]) {
                                        if continueAdding {
                                            var next = Card(front: "", back: "")
                                            next.deckId = draft.deckId; next.tags = draft.tags
                                            card = next; original = next; initialTags = tagsText
                                            preview = false; savedNotice = true
                                        } else { dismiss() }
                                    } else { editError = store.error }
                                } else {
                                    try await store.saveEditedCard(expected: expected, draft: draft, fields: card.anki == nil ? nil : noteFields)
                                    dismiss()
                                }
                            } catch { editError = error.localizedDescription }
                        }
                    }.disabled(saving || original == nil || (card.anki == nil ? card.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : previewEvents.isEmpty) || (!creating && !dirty))
                }
            }
        }
    }
}
