import SwiftUI

struct DeckPicker: View {
    @EnvironmentObject private var store: AppStore
    @Binding var selection: String
    @State private var creating = false
    var body: some View {
        Picker(L("牌组"), selection: $selection) {
            if !store.library.decks.contains(where: { $0.id == selection }) { Text(L("牌组不存在，请重新选择")).tag(selection) }
            ForEach(store.library.decks) { Text(store.library.deckPath($0.id)).tag($0.id) }
        }
        Button(L("新建牌组"), systemImage: "plus") { creating = true }
            .sheet(isPresented: $creating) { DeckEditorView(draft: Deck(id: UUID().uuidString, name: "")) { selection = $0.id; creating = false } }
    }
}

struct DeckEditorView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State var draft: Deck
    var onSaved: (Deck) -> Void
    @State private var busy = false
    @State private var error: String?
    @State private var limited = false
    @State private var advanced = false
    var body: some View {
        NavigationStack {
            Form {
                TextField(L("名称"), text: $draft.name)
                DisclosureGroup(L("可选设置"), isExpanded: $advanced) {
                    Picker(L("父牌组"), selection: Binding(get: { draft.parentId ?? "" }, set: { draft.parentId = $0.isEmpty ? nil : $0 })) {
                        Text(L("顶层")).tag("")
                        ForEach(store.library.decks.filter { !store.library.deckAncestors($0.id).contains(draft.id) }) { Text(store.library.deckPath($0.id)).tag($0.id) }
                    }.disabled(draft.id == "default")
                    Toggle(L("设置上限"), isOn: $limited)
                        .onChange(of: limited) { _, value in draft.newCardsPerDay = value ? (draft.newCardsPerDay ?? 20) : nil }
                    if limited { TextField(L("每日新卡上限"), value: Binding(get: { draft.newCardsPerDay ?? 20 }, set: { draft.newCardsPerDay = $0 }), format: .number).keyboardType(.numberPad) }
                    Text(L("仍受全局和上级牌组的每日上限约束。0 表示暂停发放新卡。")).font(.caption)
                }
                if let error { Text(localizedMessage(error)).foregroundStyle(.red) }
            }.disabled(busy).navigationTitle(L(store.library.decks.contains { $0.id == draft.id } ? "编辑牌组" : "新建牌组")).navigationBarTitleDisplayMode(.inline)
            .onAppear { limited = draft.newCardsPerDay != nil; advanced = limited || draft.parentId != nil }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("取消")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(L("保存")) {
                    guard !busy else { return }; busy = true
                    var saved = draft; saved.name = saved.name.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { defer { busy = false }; do { try await store.saveDeck(saved); onSaved(saved); dismiss() } catch { self.error = error.localizedDescription } }
                }.disabled(busy || draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }.interactiveDismissDisabled(busy)
        }
    }
}

struct DeckTree: View {
    @EnvironmentObject private var store: AppStore
    var parent: String? = nil
    var onSelect: (String) -> Void
    @State private var expanded = Set<String>()
    var body: some View {
        ForEach(store.library.decks.filter { $0.parentId == parent }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { deck in
            VStack(alignment: .leading) {
                HStack {
                    if store.library.decks.contains(where: { $0.parentId == deck.id }) {
                        Button { if !expanded.insert(deck.id).inserted { expanded.remove(deck.id) } } label: { Image(systemName: expanded.contains(deck.id) ? "chevron.down" : "chevron.right").frame(width: 32, height: 44) }
                            .buttonStyle(.borderless).accessibilityLabel(L("展开或折叠 {0}", deck.name))
                    }
                    Button { onSelect(deck.id) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(deck.name).font(.headline)
                            Text(L("{0} 张 · 今日可学 {1}", "\(store.library.cards.filter { store.library.inDeck($0, deck.id) }.count)", "\(store.deckStudyCount(deck.id))")).font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }.buttonStyle(.borderless)
                }
                if expanded.contains(deck.id) { DeckTree(parent: deck.id, onSelect: onSelect).padding(.leading, 16) }
            }
        }
    }
}

struct MoveCardsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    var ids: Set<String> = []
    var destination: String? = nil
    var onMoved: () -> Void
    @State private var target = "default"
    @State private var selected = Set<String>()
    @State private var query = ""
    @State private var busy = false
    @State private var error: String?
    private var cards: [Card] { store.library.cards.filter { ($0.deckId ?? "default") != destination && (query.isEmpty || "\($0.front)\n\($0.back)".localizedCaseInsensitiveContains(query)) } }
    var body: some View {
        NavigationStack {
            List {
                if destination == nil { DeckPicker(selection: $target) }
                else {
                    TextField(L("搜索卡片"), text: $query)
                    ForEach(cards) { card in
                        Button { if !selected.insert(card.id).inserted { selected.remove(card.id) } } label: {
                            Label(card.front, systemImage: selected.contains(card.id) ? "checkmark.circle.fill" : "circle").lineLimit(3)
                        }
                    }
                    if cards.isEmpty { Text(L("没有匹配的卡片")) }
                }
                if let error { Text(localizedMessage(error)).foregroundStyle(.red) }
            }.disabled(busy).navigationTitle(L(destination == nil ? "移动卡片" : "从现有卡片移入")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("取消")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(L("确认移动")) {
                    guard !busy else { return }; busy = true
                    Task { defer { busy = false }; do { try await store.moveCards(destination == nil ? ids : selected, to: destination ?? target); onMoved(); dismiss() } catch { self.error = error.localizedDescription } }
                }.disabled(busy || (destination == nil ? ids : selected).isEmpty) }
            }.interactiveDismissDisabled(busy)
        }
    }
}

extension AppStore {
    func deckStudyCount(_ id: String) -> Int {
        var scoped = library; scoped.cards = library.cards.filter { library.inDeck($0, id) }
        let selection = StudySelection.make(library: scoped, scope: StudyScope())
        return selection.reviews.count + selection.fresh.count
    }
    func saveDeck(_ deck: Deck) async throws {
        _ = try await persistence.commit { library in [try library.saveDeckEvent(deck)] }
    }
    func removeDeck(_ id: String) async throws {
        _ = try await persistence.commit { library in try library.removeDeckEvents(id) }
    }
    func moveCards(_ ids: Set<String>, to deckID: String) async throws {
        _ = try await persistence.commit { library in
            guard library.decks.contains(where: { $0.id == deckID }) else { throw OpenFormat.failure("牌组不存在，请重新选择") }
            return library.cards.filter { ids.contains($0.id) }.map { card in
                var moved = card; moved.deckId = deckID
                return SyncEvent(kind: .edit, card: moved)
            }
        }
    }
}
