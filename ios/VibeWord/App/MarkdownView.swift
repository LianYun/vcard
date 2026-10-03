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
                Button("完成输入") { finishTextInput() }
            }
        }
    }
}

/// Native CommonMark-style block display; images stay native UIImage/AsyncImage.
struct MarkdownView: View {
    let content: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(content.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                if let image = imageParts(line) {
                    if image.url.hasPrefix("data:image"), let comma = image.url.firstIndex(of: ","),
                       let data = Data(base64Encoded: String(image.url[image.url.index(after: comma)...])),
                       let uiImage = UIImage(data: data) {
                        Image(uiImage: uiImage).resizable().scaledToFit().accessibilityLabel(image.alt)
                    } else if let url = URL(string: image.url), ["https", "http"].contains(url.scheme ?? "") {
                        AsyncImage(url: url) { image in image.resizable().scaledToFit() }
                            placeholder: { Label("图片", systemImage: "photo") }.accessibilityLabel(image.alt)
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
        }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
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
    @Binding var text: String
    @State private var preview = false
    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Text("释义 / 背面").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(preview ? "编辑" : "预览") { preview.toggle() }.buttonStyle(.borderless)
            }
            if preview { MarkdownView(content: text).frame(minHeight: 120) }
            else {
                TextEditor(text: $text).frame(minHeight: 150).accessibilityLabel("Markdown 释义")
                    .accessibilityIdentifier("markdown.editor")
                HStack {
                    ForEach(["**粗体**", "*斜体*", "> 引用", "- 列表", "![图片](https://)", "[链接](https://)"], id: \.self) { token in
                        Button(token) { text += (text.isEmpty ? "" : "\n") + token }.font(.caption2).buttonStyle(.borderless)
                    }
                }
            }
        }
    }
}
