import SwiftUI

struct AddView: View {
    @EnvironmentObject private var store: AppStore
    let jump: (String) -> Void
    @State private var front = ""
    @State private var back = ""
    @State private var example = ""
    @State private var feedback = ""
    private var word: String { front.trimmingCharacters(in: .whitespacesAndNewlines) }
    var body: some View {
        Form {
            Section("创建卡片") {
                TextField("单词 / 正面", text: $front, axis: .vertical).textInputAutocapitalization(.never)
                    .accessibilityIdentifier("add.front")
                if store.library.llm.isConfigured {
                    Button("AI 生成（后台）", systemImage: "sparkles") {
                        store.enqueue(word); feedback = "已加入队列：\(word)"; clear()
                    }.disabled(word.isEmpty)
                } else { Text("在设置页配置 AI 模型后，可自动生成双向卡片。").font(.caption).foregroundStyle(.secondary) }
                MarkdownEditor(text: $back)
                TextField("例句（可选）", text: $example, axis: .vertical)
                    .accessibilityIdentifier("add.example")
                Button("手动添加") {
                    let card = Card(front: word, back: back.trimmingCharacters(in: .whitespacesAndNewlines),
                                    example: example.trimmingCharacters(in: .whitespacesAndNewlines))
                    if store.add([card]) { feedback = "已添加：\(word)"; clear() }
                }.disabled(word.isEmpty)
                if !feedback.isEmpty { Text(feedback).font(.caption).foregroundStyle(.green) }
            }
            Section("生成任务 · 最多 3 个并发") {
                if store.tasks.isEmpty { Text("暂无任务").foregroundStyle(.secondary) }
                ForEach(store.tasks) { task in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(task.word).bold(); Spacer(); Text(task.status).font(.caption)
                            if task.status == "生成中" { ProgressView() }
                        }
                        if let error = task.error { Text(error).font(.caption).foregroundStyle(.red) }
                        if task.finishedAt == nil { Button("取消", role: .cancel) { store.cancel(task.id) } }
                        else if task.cards.isEmpty { Button("重试") { store.enqueue(task.word) } }
                        ForEach(task.cards) { card in Button("查看：\(card.front)") { jump(card.id) }.lineLimit(2) }
                    }
                }
            }
            Section { Text("切换页面后会继续生成。iOS 在应用进入后台后可能暂停网络任务；再次打开可继续或重试。").font(.caption).foregroundStyle(.secondary) }
        }.navigationTitle("添加卡片")
        .modifier(KeyboardDoneModifier())
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { _ in store.pruneTasks() }
    }
    private func clear() { finishTextInput(); front = ""; back = ""; example = "" }
}

struct EditCardView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State var card: Card
    var body: some View {
        NavigationStack {
            Form {
                TextField("单词 / 正面", text: $card.front, axis: .vertical)
                MarkdownEditor(text: $card.back)
                TextField("例句", text: Binding(get: { card.example ?? "" }, set: { card.example = $0 }), axis: .vertical)
            }.navigationTitle("编辑卡片")
                .modifier(KeyboardDoneModifier())
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            card.front = card.front.trimmingCharacters(in: .whitespacesAndNewlines)
                            card.back = card.back.trimmingCharacters(in: .whitespacesAndNewlines)
                            if store.save([SyncEvent(kind: .edit, card: card)]) { dismiss() }
                        }.disabled(card.front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }
    }
}
