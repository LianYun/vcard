import SwiftUI

@main
struct VibeWordWatchApp: App {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @StateObject private var store = WatchStore()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            WatchRootView().environmentObject(store).tint(WatchStyle.accent).environment(\.locale, Locale(identifier: AppLanguage.resolve(interfaceLanguage, languages: Locale.preferredLanguages)))
                .onChange(of: phase) { _, value in if value == .active { store.activate() } }
        }
        .backgroundTask(.watchConnectivity) { await store.link.finishBackgroundDelivery() }
    }
}
