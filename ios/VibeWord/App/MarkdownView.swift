import SwiftUI
import UIKit

@MainActor
func finishTextInput() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

struct KeyboardDoneModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.scrollDismissesKeyboard(.interactively).toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L("完成输入")) { finishTextInput() }
            }
        }
    }
}

/// Native CommonMark-style block display; images stay native UIImage/AsyncImage.
struct MarkdownView: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    let content: String
    var centered = false
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        VStack(alignment: centered ? .center : .leading, spacing: 8) {
            ForEach(Array(MarkdownMedia.parts(content).enumerated()), id: \.offset) { _, part in
                switch part {
                case .text(let text): textBlock(text)
                case .audio(let html):
                    AnkiContentView(content: html, directory: nil)
                        .frame(height: 64)
                        .accessibilityLabel(L("播放音频"))
                }
            }
        }.frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .multilineTextAlignment(centered ? .center : .leading)
            .textSelection(.enabled)
    }
    private func textBlock(_ text: String) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 8) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                if let image = imageParts(line) {
                    if image.url.hasPrefix("data:image"), let comma = image.url.firstIndex(of: ","),
                       let data = Data(base64Encoded: String(image.url[image.url.index(after: comma)...])),
                       let uiImage = UIImage(data: data) {
                        Image(uiImage: uiImage).resizable().scaledToFit().accessibilityLabel(image.alt)
                    } else if let url = URL(string: image.url), ["https", "http"].contains(url.scheme ?? "") {
                        AsyncImage(url: url) { image in image.resizable().scaledToFit() }
                            placeholder: { Label(L("图片"), systemImage: "photo") }.accessibilityLabel(image.alt)
                    }
                } else if line.hasPrefix("### ") { inline(String(line.dropFirst(4))).font(.headline) }
                else if line.hasPrefix("## ") { inline(String(line.dropFirst(3))).font(.title2.bold()) }
                else if line.hasPrefix("# ") { inline(String(line.dropFirst(2))).font(.title.bold()) }
                else if line.hasPrefix("> ") {
                    HStack { Rectangle().fill(.indigo.opacity(0.4)).frame(width: 3); inline(String(line.dropFirst(2))).italic() }
                } else if line.hasPrefix("- ") || line.hasPrefix("* ") { HStack(alignment: .top) { Text("•"); inline(String(line.dropFirst(2))) } }
                else if line.isEmpty { Color.clear.frame(height: 3) }
                else { inline(line) }
            }
        }.frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .multilineTextAlignment(centered ? .center : .leading)
            .textSelection(.enabled)
    }
    private func inline(_ line: String) -> Text {
        Text((try? AttributedString(markdown: line, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(line))
    }
    private func imageParts(_ line: String) -> (alt: String, url: String)? {
        guard line.hasPrefix("!["), let split = line.range(of: "]("), line.hasSuffix(")") else { return nil }
        return (String(line[line.index(line.startIndex, offsetBy: 2)..<split.lowerBound]), String(line[split.upperBound..<line.index(before: line.endIndex)]))
    }
}

struct MarkdownEditor: View {
    @AppStorage(AppLanguage.key, store: AppLanguage.defaults) private var interfaceLanguage = "system"
    @Binding var text: String
    @State private var preview = false
    var body: some View {
        // Register the preference read so existing screens refresh without losing view state.
        let _ = interfaceLanguage
        VStack(alignment: .leading) {
            HStack {
                Text(L("释义 / 背面")).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(preview ? L("编辑") : L("预览")) { preview.toggle() }.buttonStyle(.borderless)
            }
            if preview { MarkdownView(content: text).frame(minHeight: 120) }
            else {
                TextEditor(text: $text).frame(minHeight: 150).accessibilityLabel(L("Markdown 释义"))
                    .accessibilityIdentifier("markdown.editor")
                HStack {
                    ForEach([L("**粗体**"), L("*斜体*"), L("> 引用"), L("- 列表"), L("![图片](https://)"), L("[链接](https://)")], id: \.self) { token in
                        Button(token) { text += (text.isEmpty ? "" : "\n") + token }.font(.caption2).buttonStyle(.borderless)
                    }
                }
            }
        }
    }
}
