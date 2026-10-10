import SwiftUI

private struct ReadingPositions: PreferenceKey {
    static var defaultValue: [Int: CGFloat] = [:]
    static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) { value.merge(nextValue(), uniquingKeysWith: { _, new in new }) }
}

struct ReadingView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    let route: ReadingRoute
    @State private var currentID: String
    @State private var block = 0
    @State private var large = false
    @State private var restoring = true
    @State private var editing: Card?
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss
    init(route: ReadingRoute) { self.route = route; _currentID = State(initialValue: route.id) }
    private var cards: [Card] {
        let byID = Dictionary(uniqueKeysWithValues: store.library.cards.map { ($0.id, $0) })
        return route.ids.compactMap { byID[$0] }
    }
    private var card: Card? { cards.first { $0.id == currentID } }
    private var index: Int { cards.firstIndex { $0.id == currentID } ?? 0 }

    var body: some View {
        let _ = interfaceLanguage
        Group {
            if let card { content(card) }
            else { ContentUnavailableView(L("这张卡片已被移除"), systemImage: "book.closed") }
        }
        .background(Color(.systemBackground))
        .navigationTitle(L("阅读"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let card {
                    Button(L("标记卡片"), systemImage: store.library.controls[card.id]?.marked == true ? "bookmark.fill" : "bookmark") { Task {
                        await store.control(card) { $0.marked = !($0.marked ?? false) }
                     } }.accessibilityIdentifier("reading.mark")
                    Menu {
                        Toggle(L("放大正文"), isOn: $large)
                        Button(L("编辑内容")) { editing = card }
                        Button(L(store.library.controls[card.id]?.suspended == true ? "恢复学习" : "暂停这张卡")) { Task { await store.control(card) { $0.suspended = !($0.suspended ?? false) }  } }
                        Button(L("删除"), role: .destructive) { deleting = true }
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel(L("阅读工具"))
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if card != nil {
                HStack {
                    Button(L("上一张"), systemImage: "chevron.left") { move(-1) }.disabled(index == 0)
                        .accessibilityIdentifier("reading.previous")
                    Spacer()
                    Text("\(index + 1) / \(cards.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        .accessibilityIdentifier("reading.position")
                    Spacer()
                    Button(L("下一张"), systemImage: "chevron.right") { move(1) }.disabled(index + 1 >= cards.count)
                        .accessibilityIdentifier("reading.next")
                }.padding().background(.regularMaterial)
            }
        }
        .onAppear {
            large = store.reading.largeText
            block = store.reading.cardID == currentID ? store.reading.block : 0
        }
        .onChange(of: large) { _, _ in remember() }
        .task(id: block) {
            do { try await Task.sleep(for: .milliseconds(250)); if !restoring { remember() } } catch { }
        }
        .onDisappear { remember() }
        .sheet(item: $editing) { EditCardView(card: $0).modifier(StoreErrorAlert()) }
        .confirmationDialog(L("删除卡片及其学习进度？"), isPresented: $deleting, titleVisibility: .visible) {
            Button(L("删除"), role: .destructive) { Task {
                guard let card else { return }
                let next = cards.indices.contains(index + 1) ? cards[index + 1].id : cards.first { $0.id != currentID }?.id
                await store.delete([card])
                if store.library.cards.contains(where: { $0.id == card.id }) { return }
                if let next { currentID = next; block = 0; remember() } else { dismiss() }
             } }
        }
    }
    private func content(_ card: Card) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .top) {
                        MarkdownView(content: card.front).font(.largeTitle.weight(.semibold))
                        SpeakButton(text: card.front, english: card.front.range(of: "^[a-zA-Z]", options: .regularExpression) != nil)
                    }.id(-1)
                    if let tags = card.tags, !tags.isEmpty { Text(tags.joined(separator: " · ")).font(.caption).foregroundStyle(.indigo) }
                    Divider()
                    ForEach(Array(MarkdownMedia.readingBlocks(card.back).enumerated()), id: \.offset) { position, text in
                        MarkdownView(content: text).font(large ? .title3 : .body).lineSpacing(7)
                            .id(position)
                            .background(GeometryReader { geo in
                                Color.clear.preference(key: ReadingPositions.self, value: [position: geo.frame(in: .named("readingScroll")).minY])
                            })
                    }
                    if let example = card.example, !example.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Text(L("例句")).font(.subheadline).foregroundStyle(.secondary); Spacer(); SpeakButton(text: example) }
                            Text(example).font(large ? .title3 : .body).lineSpacing(7).textSelection(.enabled)
                        }.padding(18).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                    }
                }.padding(24).frame(maxWidth: 680).frame(maxWidth: .infinity, alignment: .center)
            }
            .coordinateSpace(name: "readingScroll")
            .accessibilityIdentifier("reading.content")
            .onPreferenceChange(ReadingPositions.self) { positions in
                guard !restoring else { return }
                let visible = positions.filter { $0.value >= -30 }.min { $0.value < $1.value }?.key
                if let visible { block = visible }
            }
            .task(id: currentID) {
                restoring = true
                do {
                    try await Task.sleep(for: .milliseconds(100))
                    let saved = store.reading.cardID == currentID ? store.reading.block : 0
                    let maximum = max(0, MarkdownMedia.readingBlocks(card.back).count - 1)
                    block = min(saved, maximum)
                    proxy.scrollTo(block == 0 ? -1 : block, anchor: .top)
                    try await Task.sleep(for: .milliseconds(250))
                    restoring = false; remember()
                } catch { }
            }
        }
    }
    private func move(_ delta: Int) {
        let target = index + delta
        guard cards.indices.contains(target) else { return }
        restoring = true; currentID = cards[target].id; block = 0; remember()
    }
    private func remember() {
        guard card != nil else { return }
        store.rememberReading(cardID: currentID, ids: cards.map(\.id), block: block, largeText: large)
    }
}
