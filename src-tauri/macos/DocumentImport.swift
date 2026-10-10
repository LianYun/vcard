import AppKit
import PDFKit
import UniformTypeIdentifiers

struct ImportSection: Codable, Sendable {
    let id: String
    let label: String
    let text: String
    var imageId: String? = nil
}
struct ImportedDocument: Codable, Sendable {
    let name: String
    let sections: [ImportSection]
    let warnings: [String]
}

enum DocumentImport {
    static let maxBytes = 20 * 1024 * 1024
    static let maxCharacters = 300_000
    static func parse(data: Data, name: String, imageDirectory: URL) throws -> ImportedDocument {
        guard !data.isEmpty, data.count <= maxBytes else { throw failure("文档为空或超过 20 MB，请拆分后导入") }
        try FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
        var sections: [ImportSection] = [], warnings: [String] = [], written: [URL] = []
        var success = false, imageBytes = 0
        defer { if !success { for url in written { try? FileManager.default.removeItem(at: url) } } }
        func save(_ image: NSImage) throws -> String {
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { throw failure("页面图像渲染失败") }
            imageBytes += jpeg.count
            guard imageBytes <= 100 * 1024 * 1024 else { throw failure("页面图片总量超过 100 MB，请拆分文档") }
            let id = UUID().uuidString
            let url = imageDirectory.appendingPathComponent(id + ".jpg")
            try jpeg.write(to: url, options: .atomic); written.append(url)
            return id
        }
        switch (name as NSString).pathExtension.lowercased() {
        case "txt", "text", "md", "json", "jsonl":
            let text = try TextImport.decode(data)
            guard text.count <= maxCharacters else { throw failure("文本超过 30 万字符，请拆分后导入") }
            sections = text.components(separatedBy: "\n\n").enumerated().compactMap { index, paragraph in
                let value = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
                return value.isEmpty ? nil : ImportSection(id: "text-\(index + 1)", label: "文本段落 \(index + 1)", text: value)
            }
        case "csv":
            guard let rows = try? TextImport.csv(data), rows.count > 1 else {
                let fallback = try parse(data: data, name: name + ".txt", imageDirectory: imageDirectory)
                return ImportedDocument(name: name, sections: fallback.sections, warnings: fallback.warnings)
            }
            let header = rows[0]
            sections = rows.dropFirst().enumerated().map { index, row in
                ImportSection(id: "row-\(index + 2)", label: "CSV 记录 \(index + 2)", text: zip(header, row).map { "\($0): \($1)" }.joined(separator: "\n"))
            }
            if sections.isEmpty { throw failure("CSV 只有表头，没有数据记录") }
        case "pdf":
            guard let pdf = PDFDocument(data: data) else { throw failure("无法读取 PDF，文件可能损坏") }
            guard !pdf.isLocked else { throw failure("PDF 已加密，请解锁后重新导入") }
            guard pdf.pageCount <= 100 else { throw failure("图文导入最多支持 100 页，请拆分后导入") }
            for index in 0..<pdf.pageCount {
                guard let page = pdf.page(at: index) else { throw failure("无法读取 PDF 页面") }
                let bounds = page.bounds(for: .mediaBox)
                guard bounds.width > 0, bounds.height > 0 else { throw failure("PDF 页面尺寸无效") }
                let scale = 1800 / max(bounds.width, bounds.height)
                let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
                let id = try save(image)
                sections.append(ImportSection(id: "page-\(index + 1)", label: "第 \(index + 1) 页", text: page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", imageId: id))
            }
        case "docx":
            let attributed: NSAttributedString
            do { attributed = try WordPageContent.read(data) }
            catch { throw failure("无法读取 Word 文档：\(error.localizedDescription)") }
            guard attributed.length > 0 else { throw failure("Word 文档没有可渲染的内容") }
            guard attributed.length <= maxCharacters else { throw failure("文档超过 30 万字符，请拆分后导入") }
            let storage = NSTextStorage(attributedString: attributed)
            let layout = NSLayoutManager(); storage.addLayoutManager(layout)
            // Fit oversized image attachments onto an A4 content area without cropping.
            storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length)) { value, _, _ in
                guard let attachment = value as? NSTextAttachment, let cell = attachment.attachmentCell else { return }
                let size = cell.cellSize()
                guard size.width > 515 || size.height > 742 else { return }
                let factor = min(515 / max(1, size.width), 742 / max(1, size.height))
                if let data = attachment.fileWrapper?.regularFileContents, let image = NSImage(data: data) {
                    image.size = NSSize(width: size.width * factor, height: size.height * factor)
                    attachment.attachmentCell = NSTextAttachmentCell(imageCell: image)
                }
            }
            var covered = 0
            while covered < layout.numberOfGlyphs {
                guard sections.count < 100 else { throw failure("Word 排版超过 100 页，请拆分后导入") }
                let container = NSTextContainer(containerSize: NSSize(width: 515, height: 742))
                container.lineFragmentPadding = 0; layout.addTextContainer(container)
                let range = layout.glyphRange(for: container)
                guard range.length > 0, NSMaxRange(range) > covered else { throw failure("Word 内容无法分页，请另存为 PDF 后导入") }
                let size = NSSize(width: 1190, height: 1684)
                guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { throw failure("Word 页面渲染失败") }
                NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(cgContext: graphics.cgContext, flipped: true)
                let cg = graphics.cgContext
                cg.setFillColor(NSColor.white.cgColor); cg.fill(CGRect(origin: .zero, size: size))
                cg.translateBy(x: 0, y: size.height); cg.scaleBy(x: 2, y: -2)
                layout.drawBackground(forGlyphRange: range, at: NSPoint(x: 40, y: 50))
                layout.drawGlyphs(forGlyphRange: range, at: NSPoint(x: 40, y: 50))
                // Draw attachment images explicitly: some DOCX attachment cells require a text view.
                let pageCharacters = layout.characterRange(forGlyphRange: range, actualGlyphRange: nil)
                storage.enumerateAttribute(.attachment, in: pageCharacters) { value, characterRange, _ in
                    guard let attachment = value as? NSTextAttachment,
                          let data = attachment.fileWrapper?.regularFileContents,
                          let embedded = NSImage(data: data) else { return }
                    let glyphs = layout.glyphRange(forCharacterRange: characterRange, actualCharacterRange: nil)
                    var rect = layout.boundingRect(forGlyphRange: glyphs, in: container)
                    rect.origin.x += 40; rect.origin.y += 50
                    embedded.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                }
                NSGraphicsContext.restoreGraphicsState()
                let image = NSImage(size: size); image.addRepresentation(bitmap)
                let chars = layout.characterRange(forGlyphRange: range, actualGlyphRange: nil)
                let id = try save(image)
                sections.append(ImportSection(id: "word-page-\(sections.count + 1)", label: "Word 排版页 \(sections.count + 1)", text: (storage.string as NSString).substring(with: chars), imageId: id))
                covered = NSMaxRange(range)
            }
            warnings.append("Word 已重新排版为图文页面；复杂浮动布局或分页可能与原文件不同，可另存 PDF 保留原排版。")
        default: throw failure("支持 PDF、DOCX、TXT、TEXT、Markdown 和 CSV；旧版 .doc 请另存为 .docx")
        }
        guard !sections.isEmpty else { throw failure("没有可渲染页面") }
        guard sections.reduce(0, { $0 + $1.text.count }) <= maxCharacters else { throw failure("文档超过 30 万字符，请拆分后导入") }
        success = true
        return ImportedDocument(name: name, sections: sections, warnings: warnings)
    }
    static func failure(_ message: String) -> NSError { NSError(domain: "DocumentImport", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

// The system DOCX attributed-string importer can omit DrawingML images. Read the
// document's text/image order explicitly, then let TextKit paginate that content.
private final class WordPageContent: NSObject, XMLParserDelegate {
    let archive: URL
    var relationships: [String: String] = [:]
    let content = NSMutableAttributedString(string: "")
    var readingText = false
    var readingRelationships = false
    var failure: Error?
    var fontSize: CGFloat = 12
    var bold = false
    var imageSize = NSSize(width: 400, height: 300)
    var expandedBytes = 0
    var images: [(index: Int, target: String, size: NSSize)] = []
    init(archive: URL) { self.archive = archive }

    static func read(_ data: Data) throws -> NSAttributedString {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".docx")
        try data.write(to: file, options: .atomic)
        defer { try? FileManager.default.removeItem(at: file) }
        let reader = WordPageContent(archive: file)
        // Documents without images may omit relationships altogether.
        if let rels = try? reader.member("word/_rels/document.xml.rels") {
            reader.readingRelationships = true; try reader.parse(rels)
        }
        reader.readingRelationships = false
        try reader.parse(reader.member("word/document.xml"))
        for entry in reader.images.reversed() {
            let path = entry.target.hasPrefix("/") ? String(entry.target.dropFirst()) : "word/" + entry.target
            let bytes = try reader.member(path)
            guard let image = NSImage(data: bytes) else { throw DocumentImport.failure("Word 包含不支持的图片格式，请另存为 PDF") }
            let scale = min(1, 515 / entry.size.width, 720 / entry.size.height)
            image.size = NSSize(width: entry.size.width * scale, height: entry.size.height * scale)
            let wrapper = FileWrapper(regularFileWithContents: bytes); wrapper.preferredFilename = (entry.target as NSString).lastPathComponent
            let attachment = NSTextAttachment(fileWrapper: wrapper)
            attachment.attachmentCell = NSTextAttachmentCell(imageCell: image)
            reader.content.replaceCharacters(in: NSRange(location: entry.index, length: 1), with: NSAttributedString(attachment: attachment))
        }
        return reader.content
    }
    func member(_ name: String) throws -> Data {
        guard name.hasPrefix("word/"), !name.contains(".."), !name.contains("\\"),
              !name.contains("*"), !name.contains("?"), !name.contains("[") else { throw DocumentImport.failure("Word 图片路径无效") }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-p", archive.path, name]
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
        try process.run()
        var result = Data()
        while let block = try pipe.fileHandleForReading.read(upToCount: 65536), !block.isEmpty {
            result.append(block)
            if result.count > DocumentImport.maxBytes { process.terminate(); pipe.fileHandleForReading.closeFile(); process.waitUntilExit(); throw DocumentImport.failure("Word 解压内容过大") }
        }
        process.waitUntilExit()
        expandedBytes += result.count
        guard process.terminationStatus == 0, expandedBytes <= 100 * 1024 * 1024 else { throw DocumentImport.failure("Word 内容无法读取或解压后超过限制") }
        return result
    }
    func parse(_ data: Data) throws {
        let parser = XMLParser(data: data); parser.shouldResolveExternalEntities = false; parser.delegate = self
        guard parser.parse(), failure == nil else { throw failure ?? parser.parserError ?? DocumentImport.failure("Word XML 内容无效") }
    }
    func append(_ text: String) {
        content.append(NSAttributedString(string: text, attributes: [.font: bold ? NSFont.boldSystemFont(ofSize: fontSize) : NSFont.systemFont(ofSize: fontSize), .foregroundColor: NSColor.black]))
    }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes a: [String: String]) {
        if readingRelationships {
            if elementName == "Relationship", a["TargetMode"] != "External", let id = a["Id"], let target = a["Target"] { relationships[id] = target }
            return
        }
        switch elementName {
        case "w:r": fontSize = 12; bold = false
        case "w:b": bold = a["w:val"] != "0"
        case "w:sz": if let value = Double(a["w:val"] ?? "") { fontSize = min(72, max(6, value / 2)) }
        case "w:t": readingText = true
        case "w:tab": append("\t")
        case "w:br": append("\n")
        case "wp:extent":
            if let cx = Double(a["cx"] ?? ""), let cy = Double(a["cy"] ?? ""), cx > 0, cy > 0 { imageSize = NSSize(width: cx / 12700, height: cy / 12700) }
        case "a:blip", "v:imagedata":
            do {
                guard let id = a["r:embed"] ?? a["r:id"], let target = relationships[id] else { throw DocumentImport.failure("Word 图片引用缺失或为外部链接，请另存为 PDF") }
                images.append((index: content.length, target: target, size: imageSize))
                append("\u{fffc}")
            } catch { failure = error; parser.abortParsing() }
        default: break
        }
        if content.length > DocumentImport.maxCharacters { failure = DocumentImport.failure("Word 内容超过 30 万字符"); parser.abortParsing() }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { if readingText { append(string) } }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == "w:t" { readingText = false }
        if elementName == "w:p" { append("\n") }
        if elementName == "w:tc" { append("\t") }
    }
}
