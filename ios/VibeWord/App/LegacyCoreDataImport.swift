import CoreData
import Foundation

// Compatibility reader only. New app data never writes to Core Data or SQLite.
enum LegacyCoreDataImport {
    static var defaultURL: URL { NSPersistentContainer.defaultDirectoryURL().appendingPathComponent("VibeWord.sqlite") }
    static func load(at url: URL) throws -> [SyncEvent] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let model = NSManagedObjectModel()
        let entity = NSEntityDescription()
        entity.name = "SyncEvent"; entity.managedObjectClassName = "NSManagedObject"
        let payload = NSAttributeDescription()
        payload.name = "payload"; payload.attributeType = .binaryDataAttributeType
        payload.isOptional = true; payload.allowsExternalBinaryDataStorage = true; payload.allowsCloudEncryption = true
        entity.properties = [payload]; model.entities = [entity]
        let coordinator = NSPersistentStoreCoordinator(managedObjectModel: model)
        let persistent = try coordinator.addPersistentStore(type: .sqlite, at: url, options: [NSReadOnlyPersistentStoreOption: true])
        defer { try? coordinator.remove(persistent) }
        let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        context.persistentStoreCoordinator = coordinator
        return try context.performAndWait {
            try context.fetch(NSFetchRequest<NSManagedObject>(entityName: "SyncEvent")).compactMap {
                guard let data = $0.value(forKey: "payload") as? Data else { return nil }
                return try JSONDecoder().decode(SyncEvent.self, from: data)
            }
        }
    }
}
