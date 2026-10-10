import Foundation
import WatchConnectivity
import Combine

/// Transport acknowledgements never remove reviews: only a persisted phone
/// snapshot containing their IDs can acknowledge the watch's durable outbox.
@MainActor
final class WatchLink: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var reachable = false
    @Published private(set) var status = "正在连接…"
    var onData: ((String, Data) -> Void)?
    var onReady: (() -> Void)?
    private let session: WCSession?
    private var transferDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("WatchTransfers")
    }

    override init() {
        session = WCSession.isSupported() ? .default : nil
        super.init()
    }
    func activate() {
        guard let session else { status = "此设备不支持 Apple Watch 同步"; return }
        session.delegate = self
        session.activate()
    }
    var activated: Bool { session?.activationState == .activated }
    #if os(watchOS)
    func finishBackgroundDelivery() async {
        // Keep the SwiftUI background task alive while WC delivers its delegate
        // callbacks. Yield the main actor so snapshot persistence can complete.
        var idlePasses = 0
        while !Task.isCancelled && idlePasses < 2 {
            do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            idlePasses = activated && session?.hasContentPending == false ? idlePasses + 1 : 0
        }
    }
    #endif
    var installed: Bool {
        #if os(iOS)
        return session?.isPaired == true && session?.isWatchAppInstalled == true
        #else
        return session?.isCompanionAppInstalled == true
        #endif
    }
    func send(_ kind: String, data: Data, key: String) {
        guard let session, activated, installed else { return }
        let message: [String: Any] = ["kind": kind, "data": data, "key": key]
        if session.isReachable {
            session.sendMessage(message, replyHandler: { _ in }, errorHandler: { [weak self] _ in
                Task { @MainActor in self?.status = "即时连接暂不可用，等待后台同步" }
            })
        }
        // OS queue handles background delivery. The document remains the source
        // of truth if the transport is interrupted or the app is restarted.
        if !session.outstandingUserInfoTransfers.contains(where: { $0.userInfo["key"] as? String == key }) {
            session.transferUserInfo(message)
        }
    }
    func sendSnapshot(_ data: Data, revision: Int) throws {
        guard let session, activated, installed else { return }
        try FileManager.default.createDirectory(at: transferDirectory, withIntermediateDirectories: true)
        let url = transferDirectory.appendingPathComponent("\(UUID().uuidString).json")
        try data.write(to: url, options: .atomic)
        // Keep only the newest queued baseline. Its acknowledgements include all
        // reviews observed in this phone session, so replacing it loses no edits.
        for transfer in session.outstandingFileTransfers where transfer.file.metadata?["kind"] as? String == "snapshot" {
            transfer.cancel()
            try? FileManager.default.removeItem(at: transfer.file.fileURL)
        }
        session.transferFile(url, metadata: ["kind": "snapshot", "revision": revision])
        try session.updateApplicationContext(["revision": revision])
        if session.isReachable && data.count < 48_000 {
            session.sendMessage(["kind": "snapshot", "data": data], replyHandler: nil, errorHandler: nil)
        }
    }
    private func updateStatus() {
        reachable = session?.isReachable == true
        status = !installed ? "请在配对设备安装 Vibe Word" : reachable ? "已连接，可以同步" : "暂未连接，后台可用时同步"
    }
    private func receive(_ message: [String: Any]) {
        if let kind = message["kind"] as? String, let data = message["data"] as? Data {
            onData?(kind, data)
        }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            self.updateStatus()
            if let error { self.status = error.localizedDescription }
            if activationState == .activated { self.onReady?() }
        }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.updateStatus(); if self.reachable { self.onReady?() } }
    }
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in self.receive(userInfo) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.receive(message) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in self.receive(message); replyHandler(["received": true]) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        // The full snapshot travels as a file. Context is only a version hint,
        // not a reason to continuously request the same file in a feedback loop.
    }
    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["kind"] as? String == "snapshot" else { return }
        // WC deletes the temporary URL after this delegate returns.
        do {
            let size = try file.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 8_000_000 else { throw WatchStudyError.invalidData }
            let data = try Data(contentsOf: file.fileURL)
            Task { @MainActor in self.onData?("snapshot", data) }
        } catch { Task { @MainActor in self.status = "学习包读取失败，请重新同步" } }
    }
    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        let url = fileTransfer.file.fileURL
        Task { @MainActor in
            // Only remove files owned by our outgoing spool.
            if url.deletingLastPathComponent().standardizedFileURL == self.transferDirectory.standardizedFileURL {
                try? FileManager.default.removeItem(at: url)
            }
            if error != nil { self.status = "学习包等待重试，请打开应用重新同步" }
        }
    }
    #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.updateStatus(); self.onReady?() }
    }
    #endif
}

struct WatchRequest: Codable {
    var deviceID: String
    var pendingIDs: [String]
}
