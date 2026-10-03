import CloudKit
import CoreData
import Foundation
import Combine

/// The entire durable domain (including API credentials) uses encrypted CloudKit
/// fields in the user's private database. No UserDefaults mirror or public records.
@MainActor
final class Persistence: ObservableObject {
    static var isLocalPreview: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-local-preview")
        #else
        return false
        #endif
    }
    @Published private(set) var ready = false
    @Published private(set) var syncStatus = "正在打开本地数据库…"
    @Published var error: String?
    let container: NSPersistentCloudKitContainer
    var onChange: (() -> Void)?
    private var observers: [NSObjectProtocol] = []

    init() {
        let model = NSManagedObjectModel()
        let entity = NSEntityDescription()
        entity.name = "SyncEvent"
        entity.managedObjectClassName = "NSManagedObject"
        let payload = NSAttributeDescription()
        payload.name = "payload"
        payload.attributeType = .binaryDataAttributeType
        payload.isOptional = true
        payload.allowsExternalBinaryDataStorage = true
        payload.allowsCloudEncryption = true
        entity.properties = [payload]
        model.entities = [entity]
        container = NSPersistentCloudKitContainer(name: "VibeWord", managedObjectModel: model)
        let description = container.persistentStoreDescriptions[0]
        let identifier = Bundle.main.object(forInfoDictionaryKey: "CloudKitContainer") as? String ?? "iCloud.com.lianyun.vibeword"
        if Self.isLocalPreview {
            description.cloudKitContainerOptions = nil
            description.url = NSPersistentContainer.defaultDirectoryURL().appendingPathComponent("SimulatorPreview.sqlite")
            #if DEBUG && targetEnvironment(simulator)
            // UI tests use their own durable store, never the user's preview data.
            if let value = ProcessInfo.processInfo.environment["VIBE_TEST_STORE"], let id = UUID(uuidString: value) {
                description.url = NSPersistentContainer.defaultDirectoryURL().appendingPathComponent("UITest-\(id.uuidString).sqlite")
            }
            #endif
        } else {
            description.cloudKitContainerOptions = NSPersistentCloudKitContainerOptions(containerIdentifier: identifier)
        }
        description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
        description.setOption(true as NSNumber, forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
        #if os(iOS)
        description.setOption(FileProtectionType.completeUntilFirstUserAuthentication.rawValue as NSString,
                              forKey: NSPersistentStoreFileProtectionKey)
        #endif
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.loadPersistentStores { [weak self] _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error { self.error = "数据库打开失败：\(error.localizedDescription)"; return }
                self.ready = true
                self.syncStatus = Self.isLocalPreview ? "模拟器本地预览 · 未启用 iCloud" : "本地数据已就绪；iCloud 自动同步"
                self.onChange?()
                await self.checkAccount()
                #if DEBUG
                if !Self.isLocalPreview && ProcessInfo.processInfo.arguments.contains("-initializeCloudKitSchema") {
                    do { try self.container.initializeCloudKitSchema() }
                    catch { self.error = "CloudKit Schema 初始化失败：\(error.localizedDescription)" }
                }
                #endif
            }
        }
        observers.append(NotificationCenter.default.addObserver(
            forName: .NSPersistentStoreRemoteChange, object: container.persistentStoreCoordinator, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.onChange?() }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: NSPersistentCloudKitContainer.eventChangedNotification, object: container, queue: .main
        ) { [weak self] note in
            guard let event = note.userInfo?[NSPersistentCloudKitContainer.eventNotificationUserInfoKey]
                as? NSPersistentCloudKitContainer.Event else { return }
            Task { @MainActor in
                guard let self else { return }
                if let error = event.error { self.syncStatus = "同步未完成：\(error.localizedDescription)" }
                else if event.endDate == nil { self.syncStatus = "正在同步 iCloud…" }
                else if event.succeeded {
                    self.syncStatus = "最近同步活动：\(event.endDate!.formatted(date: .omitted, time: .shortened))"
                    self.onChange?()
                }
            }
        })
        observers.append(NotificationCenter.default.addObserver(forName: .CKAccountChanged, object: nil, queue: .main) {
            [weak self] _ in Task { @MainActor in await self?.checkAccount() }
        })
    }

    func checkAccount() async {
        guard !Self.isLocalPreview else { return }
        let id = Bundle.main.object(forInfoDictionaryKey: "CloudKitContainer") as? String ?? "iCloud.com.lianyun.vibeword"
        do {
            let status = try await CKContainer(identifier: id).accountStatus()
            if status != .available { syncStatus = "iCloud 不可用；数据仍保存在本机，请检查系统 iCloud 设置" }
        } catch { syncStatus = "无法连接 iCloud；本地修改等待同步" }
    }

    func load() throws -> [SyncEvent] {
        // A fresh context sees imported rows without retaining stale registered objects.
        let context = container.newBackgroundContext()
        return try context.performAndWait {
            let request = NSFetchRequest<NSManagedObject>(entityName: "SyncEvent")
            return try context.fetch(request).compactMap { object in
                guard let data = object.value(forKey: "payload") as? Data else { return nil }
                return try JSONDecoder().decode(SyncEvent.self, from: data)
            }
        }
    }

    func append(_ events: [SyncEvent]) throws {
        guard ready else { throw GenerationService.Failure("数据库尚未就绪") }
        let context = container.viewContext
        do {
            for event in events {
                let object = NSEntityDescription.insertNewObject(forEntityName: "SyncEvent", into: context)
                object.setValue(try JSONEncoder().encode(event), forKey: "payload")
            }
            try context.save() // One transaction for paired cards/progress/stats.
        } catch { context.rollback(); throw error }
        onChange?()
    }
}
