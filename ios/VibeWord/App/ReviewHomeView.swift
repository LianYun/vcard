import SwiftUI

struct ReviewHomeView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    var onStudy: () -> Void
    var onRead: () -> Void
    var onSettings: () -> Void
    @State private var scope = false
    @State private var ahead = false
    @State private var statistics = false
    private var selection: StudySelection { StudySelection.make(library: store.library, scope: store.library.studyScope) }
    private var hasWork: Bool { !store.queue.isEmpty || !selection.reviews.isEmpty || !selection.fresh.isEmpty }

    var body: some View {
        let _ = interfaceLanguage
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 20) {
                    Label(L("今天，记住一点新东西"), systemImage: "sun.max")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if !store.queue.isEmpty {
                        Text(L("继续上次复习")).font(.largeTitle.bold())
                        Text(L("还剩 {0} 张卡片", "\(store.queue.count)")).font(.title3).foregroundStyle(.secondary)
                    } else if hasWork {
                        Text(L("今日待复习 {0} 张", "\(selection.reviews.count)")).font(.largeTitle.bold())
                        Text(L("可引入新卡 {0} 张", "\(selection.fresh.count)")).font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text(L(store.library.cards.isEmpty ? "从第一张卡片开始" : "可以轻松读一会儿了"))
                            .font(.largeTitle.bold())
                        Text(L(store.library.cards.isEmpty ? "在卡片页添加内容，或从 Mac 同步。" : selection.emptyReason))
                            .foregroundStyle(.secondary)
                    }
                    Button(action: hasWork ? onStudy : onRead) {
                        Label(L(hasWork ? (store.queue.isEmpty ? "开始今日复习" : "继续复习") : "去读卡片"), systemImage: hasWork ? "play.fill" : "book")
                            .font(.headline).frame(maxWidth: .infinity, minHeight: 48)
                    }.buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("cards.startStudy")
                    HStack(alignment: .firstTextBaseline) {
                        Text(L("学习范围：{0}", store.queue.isEmpty ? store.library.studyScope.label : store.sessionScope.label))
                            .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("cards.studyScope")
                        Spacer()
                        Button(L("更改")) { scope = true }.accessibilityIdentifier("review.scope")
                    }
                }
                .padding(24).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))

                HStack(spacing: 12) {
                    Button { scope = true } label: { shortcut("按标签复习", "tag") }
                        .accessibilityIdentifier("cards.tagStudy")
                    Button { ahead = true } label: { shortcut("提前复习", "calendar") }
                        .accessibilityIdentifier("review.ahead")
                }.buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text(L("近 7 天学习记录")).font(.headline)
                        Spacer()
                        Button(L("查看详情")) { statistics = true }.font(.subheadline)
                            .accessibilityIdentifier("review.statistics")
                    }
                    HStack {
                        ForEach((0..<7).reversed(), id: \.self) { offset in
                            let day = Day.adding(-offset, to: Day.key())
                            let count = store.library.stats[day]?.reviewed ?? 0
                            VStack(spacing: 8) {
                                Image(systemName: count > 0 ? "checkmark.circle.fill" : "circle")
                                    .font(.title2).foregroundStyle(count > 0 ? Color.indigo : Color.secondary.opacity(0.3))
                                Text(String(day.suffix(2))).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(L("{0} · 复习 {1}", day, "\(count)"))
                        }
                    }
                }.padding(.horizontal, 4)
                if persistence.iCloudEnabled {
                    Button(action: onSettings) {
                        Label(localizedMessage(persistence.syncStatus), systemImage: "icloud")
                            .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain)
                }
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(L("复习"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(L("设置"), systemImage: "gearshape", action: onSettings).accessibilityIdentifier("open.settings")
            }
        }
        .sheet(isPresented: $scope) { NavigationStack { TagStudyView() }.modifier(StoreErrorAlert()) }
        .sheet(isPresented: $ahead) { NavigationStack { StudyCenterView(section: 0) }.modifier(StoreErrorAlert()) }
        .sheet(isPresented: $statistics) { NavigationStack { StudyCenterView(section: 1) }.modifier(StoreErrorAlert()) }
    }
    private func shortcut(_ title: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: symbol).font(.title2).foregroundStyle(.indigo)
            Text(L(title)).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}
