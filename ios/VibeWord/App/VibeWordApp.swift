import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct VibeWordApp: App {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @StateObject private var persistence: Persistence
    @StateObject private var store: AppStore
    init() {
        let persistence = Persistence(fixedICloud: true)
        _persistence = StateObject(wrappedValue: persistence)
        _store = StateObject(wrappedValue: AppStore(persistence: persistence))
    }
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).environmentObject(persistence)
                .tint(.indigo)
                .environment(\.locale, Locale(identifier: AppLanguage.resolve(interfaceLanguage, languages: Locale.preferredLanguages)))
        }
    }
}

struct RootView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @Environment(\.scenePhase) private var phase
    @State private var tab = 0
    @State private var highlighted: String?
    @State private var studying = false
    @State private var settings = false

    private var aiBadge: Text? {
        let count = store.tasks.reduce(0) { $0 + $1.readyCount }
        if count > 0 { return Text(String(count)) }
        return store.tasks.contains { ["queued", "running"].contains($0.status) } ? Text("●") : nil
    }
    var body: some View {
        let _ = interfaceLanguage
        Group {
            if persistence.ready && store.localStateLoaded {
                TabView(selection: $tab) {
                    NavigationStack {
                        ReviewHomeView(onStudy: {
                            Task { if !store.queue.isEmpty { studying = true } else if await store.startSession() { studying = true } }
                        }, onRead: { tab = 1 }, onSettings: { settings = true })
                    }.tabItem { Label(L("复习"), systemImage: "rectangle.on.rectangle") }.tag(0)
                    CardsView(highlighted: $highlighted, onSettings: { settings = true })
                        .tabItem { Label(L("卡片"), systemImage: "books.vertical") }.tag(1)
                    NavigationStack { TaskQueueView() }
                        .tabItem { Label(L("任务队列"), systemImage: "list.bullet.rectangle") }
                        .badge(aiBadge).tag(2)
                }
            } else if let error = persistence.error {
                ContentUnavailableView(L("无法打开数据"), systemImage: "externaldrive.badge.exclamationmark", description: Text(localizedMessage(error)))
            } else { ProgressView(L("正在加载 Vibe Word…")) }
        }
        .sheet(isPresented: $settings) { SettingsSheet() }
        .fullScreenCover(isPresented: $studying) {
            NavigationStack { StudyView(exitTitle: "返回复习") }.modifier(StoreErrorAlert())
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { store.setAIActive(true); Task { await persistence.synchronize() } }
            if phase == .background { Task { await store.pauseAITasks() } }
        }
        .task(id: store.localStateLoaded) {
            guard store.localStateLoaded, let directory = persistence.store?.directory else { return }
            // Async opening means the first onAppear precedes local data readiness.
            let hasDraft = try? await EventWorkers.run {
                FileManager.default.fileExists(atPath: directory.appendingPathComponent("settings-draft.json").path)
            }
            if hasDraft == true { settings = true }
        }
        .modifier(StoreErrorAlert())
    }
}

struct StoreErrorAlert: ViewModifier {
    @EnvironmentObject private var store: AppStore
    func body(content: Content) -> some View {
        content.alert(L("操作未完成"), isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button(L("知道了")) { store.error = nil }
        } message: { Text(localizedMessage(store.error ?? "")) }
    }
}
