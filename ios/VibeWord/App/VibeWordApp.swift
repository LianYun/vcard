import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !Persistence.isLocalPreview { application.registerForRemoteNotifications() }
        return true
    }
}

@main
struct VibeWordApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var persistence: Persistence
    @StateObject private var store: AppStore
    init() {
        let persistence = Persistence()
        _persistence = StateObject(wrappedValue: persistence)
        _store = StateObject(wrappedValue: AppStore(persistence: persistence))
    }
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).environmentObject(persistence)
                .tint(.indigo)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @Environment(\.scenePhase) private var phase
    @State private var tab = 0
    @State private var highlighted: String?
    var body: some View {
        Group {
            if persistence.ready {
                TabView(selection: $tab) {
                    NavigationStack { StudyView() }.tabItem { Label("学习", systemImage: "rectangle.on.rectangle") }.tag(0)
                    NavigationStack {
                        AddView { id in highlighted = id; tab = 2 }
                    }.tabItem { Label("添加", systemImage: "plus.circle") }.tag(1)
                    NavigationStack { CardsView(highlighted: $highlighted) }
                        .tabItem { Label("卡片", systemImage: "books.vertical") }.tag(2)
                    NavigationStack { SettingsView() }.tabItem { Label("设置", systemImage: "gearshape") }.tag(3)
                }
            } else if let error = persistence.error {
                ContentUnavailableView("无法打开数据", systemImage: "externaldrive.badge.exclamationmark", description: Text(error))
            } else { ProgressView("正在加载 Vibe Word…") }
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { store.reload(); Task { await persistence.checkAccount() } }
        }
        .alert("操作未完成", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("知道了") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
}
