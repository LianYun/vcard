import SwiftUI
import UniformTypeIdentifiers

struct MarkdownDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

struct CardsView: View {
    @EnvironmentObject private var store: AppStore
    @Binding var highlighted: String?
    @State private var query = ""
    @State private var selection = Set<String>()
    @State private var selecting = false
    @State private var editing: Card?
    @State private var deleting: Card?
    @State private var exporting = false
    @State private var exportText = ""
    @State private var collapsed = Set<String>()
    private let labels = ["今天", "昨天", "本周", "本月", "更早", "未知"]
    private var filtered: [Card] {
        store.library.cards.filter { query.isEmpty || "\($0.front)\n\($0.back)\n\($0.example ?? "")".localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        ScrollViewReader { reader in
            List {
                Section {
                    HStack {
                        stat("今日待复习", store.schedule.due.count)
                        stat("今日新词", store.schedule.fresh.count)
                        stat("总卡片数", store.library.cards.count)
                    }
                    HeatmapView(stats: store.library.stats)
                }
                if selecting {
                    Button("全选 / 取消当前搜索结果") {
                        let visible = Set(filtered.map(\.id))
                        if visible.isSubset(of: selection) { selection.subtract(visible) } else { selection.formUnion(visible) }
                    }
                }
                if filtered.isEmpty { Text(query.isEmpty ? "还没有卡片，去添加第一个单词吧。" : "没有匹配的卡片").foregroundStyle(.secondary) }
                ForEach(labels, id: \.self) { label in
                    let cards = filtered.filter { group($0) == label }
                    if !cards.isEmpty {
                        Section {
                            if !collapsed.contains(label) {
                                ForEach(cards) { card in
                                    VStack(alignment: .leading, spacing: 12) {
                                        HStack {
                                            if selecting {
                                                Button { if !selection.insert(card.id).inserted { selection.remove(card.id) } } label: {
                                                    Image(systemName: selection.contains(card.id) ? "checkmark.circle.fill" : "circle")
                                                }.buttonStyle(.borderless).accessibilityLabel("选择 \(card.front)")
                                            }
                                            Text(card.front).font(.headline)
                                            Spacer(); SpeakButton(text: card.front, english: card.front.range(of: "^[a-zA-Z]", options: .regularExpression) != nil)
                                        }
                                        MarkdownView(content: card.back)
                                        if let example = card.example, !example.isEmpty {
                                            HStack { Text(example).font(.subheadline).italic(); SpeakButton(text: example) }
                                        }
                                        if !selecting {
                                            HStack {
                                                Button("编辑") { editing = card }
                                                Spacer()
                                                Button("删除", role: .destructive) { deleting = card }
                                            }.buttonStyle(.borderless).font(.caption)
                                        }
                                    }.padding(.vertical, 8).id(card.id)
                                    .listRowBackground(highlighted == card.id ? Color.green.opacity(0.12) : Color(.secondarySystemGroupedBackground))
                                }
                            }
                        } header: {
                            Button("\(label) · \(cards.count) \(collapsed.contains(label) ? "＋" : "−")") {
                                if !collapsed.insert(label).inserted { collapsed.remove(label) }
                            }
                        }
                    }
                }
            }
            .onChange(of: highlighted) { _, id in reveal(id, reader: reader) }
            .onAppear { reveal(highlighted, reader: reader) }
        }
        .navigationTitle("我的卡片").searchable(text: $query, prompt: "搜索单词、释义、例句")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button(selecting ? "完成" : "选择") { selecting.toggle(); selection.removeAll() } }
            ToolbarItem(placement: .topBarTrailing) {
                Button("导出") {
                    let cards = selecting ? store.library.cards.filter { selection.contains($0.id) } : filtered
                    exportText = Obsidian.markdown(cards); exporting = true
                }.disabled(selecting ? selection.isEmpty : filtered.isEmpty)
            }
        }
        .sheet(item: $editing) { EditCardView(card: $0) }
        .confirmationDialog("删除卡片及其学习进度？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("删除", role: .destructive) { if let deleting { store.delete([deleting]) }; deleting = nil }
            Button("取消", role: .cancel) { deleting = nil }
        }
        .fileExporter(isPresented: $exporting, document: MarkdownDocument(text: exportText), contentType: .plainText,
                      defaultFilename: "vibe-word-\(Day.key()).md") { result in
            if case .failure(let error) = result { store.error = "导出失败：\(error.localizedDescription)" }
        }
    }
    private func stat(_ title: String, _ count: Int) -> some View {
        VStack { Text("\(count)").font(.title2.bold()).foregroundStyle(.indigo); Text(title).font(.caption2) }.frame(maxWidth: .infinity)
    }
    private func group(_ card: Card) -> String {
        guard let timestamp = card.createdAt else { return "未知" }
        let day = Day.key(Date(timeIntervalSince1970: timestamp)), today = Day.key()
        if day >= today { return "今天" }; if day >= Day.adding(-1, to: today) { return "昨天" }
        if day >= Day.adding(-7, to: today) { return "本周" }; if day >= Day.adding(-30, to: today) { return "本月" }
        return "更早"
    }
    private func reveal(_ id: String?, reader: ScrollViewProxy) {
        guard let id, let card = store.library.cards.first(where: { $0.id == id }) else { return }
        query = ""; collapsed.remove(group(card))
        DispatchQueue.main.async { withAnimation { reader.scrollTo(id, anchor: .center) } }
    }
}

struct HeatmapView: View {
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
        VStack(alignment: .leading, spacing: 12) {
            Text("学习记录").font(.headline)
            Text("连续 \(streak) 天 · 累计 \(recent.filter { $0.total > 0 }.count) 天\n复习 \(recent.reduce(0) { $0 + $1.reviewed }) · 新增 \(recent.reduce(0) { $0 + $1.added })")
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
                                    .disabled(key > Day.key()).accessibilityLabel("\(key)，\(count) 次活动")
                            }
                        }
                    }
                }
            }
            if let selected { Text("\(selected) · 复习 \(stats[selected]?.reviewed ?? 0) · 新增 \(stats[selected]?.added ?? 0)").font(.caption) }
        }.padding(.vertical, 8)
    }
    private func color(_ n: Int) -> Color { n == 0 ? Color.gray.opacity(0.15) : Color.green.opacity(n <= 2 ? 0.3 : n <= 5 ? 0.5 : n <= 9 ? 0.75 : 1) }
}
