import SwiftUI
import WebKit

/// Scripts and external requests are disabled. Only hash-addressed local media is served.
struct AnkiContentView: UIViewRepresentable {
    let content: String
    let directory: URL?
    func makeCoordinator() -> Coordinator { Coordinator(directory: directory) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.setURLSchemeHandler(context.coordinator, forURLScheme: "vibe-media")
        config.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false; view.backgroundColor = .clear
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.content != content else { return }
        context.coordinator.content = content
        let html = """
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vibe-media: data:; media-src vibe-media: data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'">
        <style>:root{color-scheme:light dark}body{font:18px -apple-system;line-height:1.6;margin:8px;overflow-wrap:anywhere}img{max-width:100%;height:auto}audio{max-width:100%}.cloze{color:#6366f1}table{max-width:100%}</style>
        \(content)
        """
        view.loadHTMLString(html, baseURL: nil)
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { view.loadHTMLString("", baseURL: nil); view.stopLoading() }
    final class Coordinator: NSObject, WKURLSchemeHandler, WKNavigationDelegate {
        let directory: URL?; var content = ""
        init(directory: URL?) { self.directory = directory }
        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            do {
                guard let url = urlSchemeTask.request.url, let directory else { throw OpenFormat.failure("附件未就绪") }
                let id = String(url.absoluteString.dropFirst("vibe-media:".count))
                guard MediaStore.valid(id) else { throw OpenFormat.failure("附件标识无效") }
                let data = try OpenFormat.read(directory.appendingPathComponent("media/" + id))
                guard OpenFormat.digest(data) == id.components(separatedBy: ".")[0] else { throw OpenFormat.failure("附件校验失败") }
                urlSchemeTask.didReceive(URLResponse(url: url, mimeType: MediaStore.mime(id), expectedContentLength: data.count, textEncodingName: nil))
                urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
            } catch { urlSchemeTask.didFailWithError(error) }
        }
        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(navigationAction.navigationType == .other && navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
        }
    }
}
struct CardContentView: View {
    @EnvironmentObject private var store: AppStore
    let card: Card
    var back = false
    var body: some View {
        if card.anki != nil {
            AnkiContentView(content: back ? card.back : card.front, directory: store.persistence.store?.directory)
                .id(card.id + (back ? ":back" : ":front") + ":" + String(store.libraryRevision)).frame(minHeight: 300)
        } else { MarkdownView(content: back ? card.back : card.front) }
    }
}
