import SwiftUI

struct ReadingRoute: Identifiable {
    let id: String
    let ids: [String]
}

struct CardsView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Binding var highlighted: String?
    var onSettings: () -> Void
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var query = ""
    @State private var filter = StudyFilter.all
    @State private var tag: String?
    @State private var sort = 0
    @State private var filters = false
    @State private var adding = false
    @State private var pendingSettings = false
    @State private var quick = false
    @State private var route: ReadingRoute?
    @State private var phoneReading = false
    @State private var selecting = false
    @State private var selected = Set<String>()
    @State private var deleting = false
    private var tags: [String] { Array(Set(store.library.cards.flatMap { $0.tags ?? [] })).sorted() }
    private var filtered: [Card] {
        let cards = store.library.cards.filter { card in
            filter.matches(card, library: store.library) &&
            (tag == nil || (tag == "" ? (card.tags ?? []).isEmpty : (card.tags ?? []).contains(tag!))) &&
            (query.isEmpty || "\(card.front)\n\(card.back)\n\(card.example ?? "")".localizedCaseInsensitiveContains(query))
        }
        return cards.sorted {
            if sort == 1 { return $0.front.localizedStandardCompare($1.front) == .orderedAscending }
            if $0.createdAt == $1.createdAt { return $0.id < $1.id }
            return ($0.createdAt ?? 0) > ($1.createdAt ?? 0)
        }
    }
    var body: some View {
        let _ = interfaceLanguage
        Group {
            if sizeClass == .regular {
                NavigationSplitView(columnVisibility: $columns) {
                    library
                } detail: {
                    if let route { ReadingView(route: route).id(route.id) }
                    else { ContentUnavailableView(L("选择一张卡片开始阅读"), systemImage: "book") }
                }.navigationSplitViewStyle(.balanced)
            } else {
                NavigationStack {
                    library.navigationDestination(isPresented: $phoneReading) {
                        if let route { ReadingView(route: route).id(route.id) }
                    }
                }
            }
        }
        .sheet(isPresented: $adding, onDismiss: {
            if pendingSettings { pendingSettings = false; onSettings() }
        }) {
            NavigationStack {
                AddView(jump: { id in
                    adding = false
                    highlighted = id
                }, onSettings: { pendingSettings = true; adding = false })
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("关闭")) { adding = false } } }
            }.modifier(StoreErrorAlert())
        }
        .sheet(isPresented: $filters) { filterSheet }
        .fullScreenCover(isPresented: $quick) { NavigationStack { QuickLearningView(cards: filtered) } }
        .onChange(of: highlighted) { _, id in
            guard let id else { return }
            query = ""; tag = nil; filter = .all
            open(id, ids: store.library.cards.map(\.id)); highlighted = nil
        }
    }
    private var library: some View {
        List {
            if !selecting {
                if let id = store.reading.cardID, let card = store.library.cards.first(where: { $0.id == id }) {
                    Button { open(id, ids: store.reading.ids) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(L("继续阅读")).font(.caption).foregroundStyle(.secondary)
                                Text(card.front).font(.headline).lineLimit(1).foregroundStyle(.primary)
                            }
                        } icon: { Image(systemName: "book.pages").foregroundStyle(.indigo) }
                    }.accessibilityIdentifier("cards.continueReading")
                }
                if !store.tasks.isEmpty {
                    NavigationLink { TaskQueueView() } label: {
                        let active = store.tasks.filter { ["queued", "running"].contains($0.status) }.count
                        Label(active > 0 ? L("正在生成 {0} 项", "\(active)") : L("查看生成结果"), systemImage: "sparkles")
                    }.accessibilityIdentifier("cards.tasks")
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach([StudyFilter.all, .marked, .recent], id: \.self) { value in
                            Button(L(value.rawValue)) { filter = value }
                                .buttonStyle(.bordered).tint(filter == value ? .indigo : .secondary)
                        }
                        Button(L("筛选"), systemImage: "line.3.horizontal.decrease") { filters = true }
                            .buttonStyle(.bordered).accessibilityIdentifier("cards.filters")
                    }
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                if tag != nil || ![StudyFilter.all, .marked, .recent].contains(filter) {
                    HStack {
                        Text([L(filter.rawValue), tag.map { $0.isEmpty ? L("未打标签") : $0 }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button(L("清除筛选")) { filter = .all; tag = nil }.font(.caption)
                    }
                }
            }
            Section {
                ForEach(filtered) { card in
                    Button {
                        if selecting {
                            if !selected.insert(card.id).inserted { selected.remove(card.id) }
                        } else { open(card.id, ids: filtered.map(\.id)) }
                    } label: {
                        HStack(spacing: 12) {
                            if selecting { Image(systemName: selected.contains(card.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(.indigo) }
                            VStack(alignment: .leading, spacing: 7) {
                                Text(card.front.components(separatedBy: .newlines).first ?? card.front)
                                    .font(.headline).foregroundStyle(.primary).lineLimit(2)
                                Text(summary(card.back)).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                HStack {
                                    if let tags = card.tags, !tags.isEmpty { Text(tags.prefix(2).joined(separator: " · ")).lineLimit(1) }
                                    Spacer()
                                    if store.library.controls[card.id]?.marked == true { Image(systemName: "bookmark.fill") }
                                    Text(L(store.library.controls[card.id]?.suspended == true ? "已暂停" : StudyEngine.isNew(store.library.progress[card.id]) ? "新卡" : "已学"))
                                }.font(.caption).foregroundStyle(.secondary)
                            }
                            if !selecting { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
                        }.padding(.vertical, 8).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("library.card.\(card.id)")
                }
                if filtered.isEmpty {
                    ContentUnavailableView(L(store.library.cards.isEmpty ? "还没有卡片" : "没有匹配的卡片"), systemImage: "books.vertical", description: Text(L("添加内容或调整筛选，开始阅读。")))
                    if store.library.cards.isEmpty { Button(L("添加卡片")) { adding = true } }
                    else { Button(L("清除筛选")) { query = ""; filter = .all; tag = nil } }
                }
            } header: { Text(L("共 {0} 张卡片", "\(filtered.count)")) }
        }
        .navigationTitle(L("卡片"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: L("搜索单词、释义、例句"))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if selecting {
                    Button(L("完成")) { selecting = false; selected = [] }
                } else {
                    Menu {
                        Button(L("翻卡浏览")) { quick = true }.disabled(filtered.isEmpty).accessibilityIdentifier("cards.quickLearning")
                        Button(L("选择卡片")) { selecting = true }
                        Button(L("设置"), action: onSettings)
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel(L("卡片工具"))
                    Button(L("添加卡片"), systemImage: "plus") { adding = true }.accessibilityIdentifier("cards.add")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if selecting {
                HStack {
                    Button(L("全选当前结果")) { selected = Set(filtered.map(\.id)) }
                    Spacer()
                    Button(L("删除 {0} 张", "\(selected.count)"), role: .destructive) { deleting = true }.disabled(selected.isEmpty)
                }.padding().background(.regularMaterial)
            }
        }
        .confirmationDialog(L("删除卡片及其学习进度？"), isPresented: $deleting, titleVisibility: .visible) {
            Button(L("删除"), role: .destructive) {
                Task { await store.delete(store.library.cards.filter { selected.contains($0.id) }); selected = []; selecting = false }
            }
        }
    }
    private var filterSheet: some View {
        NavigationStack {
            Form {
                Picker(L("卡片状态"), selection: $filter) { ForEach(StudyFilter.allCases, id: \.self) { Text(L($0.rawValue)).tag($0) } }
                Picker(L("按标签筛选"), selection: $tag) {
                    Text(L("全部卡片")).tag(String?.none)
                    Text(L("未打标签")).tag(String?.some(""))
                    ForEach(tags, id: \.self) { Text($0).tag(String?.some($0)) }
                }.accessibilityIdentifier("cards.tagFilter")
                Picker(L("排序"), selection: $sort) {
                    Text(L("最近添加")).tag(0); Text(L("按标题排序")).tag(1)
                }
            }.navigationTitle(L("筛选"))
                .toolbar { Button(L("完成")) { filters = false } }
        }.presentationDetents([.medium, .large])
    }
    private func open(_ id: String, ids: [String]) { route = ReadingRoute(id: id, ids: ids); phoneReading = true }
    private func summary(_ text: String) -> String {
        text.components(separatedBy: .newlines).filter { !$0.hasPrefix("![") && !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .prefix(2).joined(separator: " ").replacingOccurrences(of: "#", with: "").replacingOccurrences(of: "**", with: "")
    }
}
