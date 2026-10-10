import AppKit
import CoreText
import PDFKit

enum DocumentImportTests {
    static func run() throws {
        let imageDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("import-images-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: imageDirectory) }
        let plain = try DocumentImport.parse(data: Data("\u{feff}First paragraph.\r\n\r\nSecond paragraph.".utf8), name: "source.txt", imageDirectory: imageDirectory)
        precondition(plain.sections.count == 2 && plain.sections.allSatisfy { $0.imageId == nil })
        let csv = Data("\u{feff}id,front,back,example,createdAt\r\nword:cue,cue,\"含义,包含逗号\n第二行\",\"say \"\"hello\"\"\",123\r\n".utf8)
        let table = try TextImport.csv(csv)
        precondition(table.count == 2 && table[1][2] == "含义,包含逗号\n第二行" && table[1][3] == "say \"hello\"")
        let direct = try TextImport.cardFile(csv)
        precondition(direct.cards.count == 1 && direct.cards[0].id == "word:cue" && direct.cards[0].createdAt == 123)
        let jsonl = Data("{\"id\":\"word:cue\",\"front\":\"cue\",\"back\":\"提示\"}\n".utf8)
        let jsonlCards = try TextImport.structuredCards(jsonl, name: "cards.JSONL")
        precondition(jsonlCards.cards.count == 1)
        let routingDirectory = imageDirectory.appendingPathComponent("routing")
        let routingStore = try JSONEventStore(directory: routingDirectory)
        let imported = try CloudBridge.importFile(data: jsonl, name: "cards.jsonl", directory: routingDirectory, store: routingStore) as! [String: Int]
        precondition(imported["importedCount"] == 1)
        let fallback = try CloudBridge.importFile(data: Data("{\"word\":\"cue\"}".utf8), name: "source.jsonl", directory: routingDirectory, store: routingStore) as! [String: Any]
        precondition(fallback["sections"] != nil && fallback["importedCount"] == nil)
        let brokenCSV = try DocumentImport.parse(data: Data("word,meaning\n\"cue,提示".utf8), name: "broken.csv", imageDirectory: imageDirectory)
        precondition(brokenCSV.name == "broken.csv" && !brokenCSV.sections.isEmpty)
        let material = try DocumentImport.parse(data: Data("word,meaning\ncue,提示\n".utf8), name: "source.csv", imageDirectory: imageDirectory)
        precondition(material.sections.count == 1 && material.sections[0].text.contains("word: cue") && material.sections[0].imageId == nil)
        func invalidCSV(_ text: String, cards: Bool = false) {
            do {
                if cards { _ = try TextImport.cardFile(Data(text.utf8)) } else { _ = try TextImport.csv(Data(text.utf8)) }
                preconditionFailure("CSV should fail")
            } catch { }
        }
        invalidCSV("a,a\n1,2")
        invalidCSV("a,b\n1")
        invalidCSV("a,b\n\"unclosed,2")
        invalidCSV("a,b\n\"closed\"extra,2")
        invalidCSV("front,back\ncue,提示", cards: true)
        invalidCSV("id,front,back\na,cue,提示\na,cue,提示", cards: true)
        invalidCSV("id,front,back,createdAt\na,cue,提示,-1", cards: true)
        invalidCSV("id,front,back,unknown\na,cue,提示,x", cards: true)
        let csvExample = try TextImport.cardFile(Data(contentsOf: URL(fileURLWithPath: "docs/formats/cards.example.csv")))
        let jsonExample = try CardFile.decode(Data(contentsOf: URL(fileURLWithPath: "docs/formats/cards.example.json")))
        precondition(csvExample.cards.map(\.id) == jsonExample.cards.map(\.id))
        precondition(csvExample.cards.map(\.back) == jsonExample.cards.map(\.back))
        let roundtrip = try CardFile.decode(OpenFormat.encode(csvExample))
        precondition(roundtrip.cards.count == 2)
        print("PASS: UTF-8/BOM TXT, generic CSV source, multiline/quoted CSV cards, malformed CSV, duplicate IDs, timestamp validation, shipped CSV/JSON examples")
        let text = "Resilience helps people adapt.\nA cue triggers a response."
        let word = NSAttributedString(string: text)
        let docx = try word.data(from: NSRange(location: 0, length: word.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML])
        let parsedWord = try DocumentImport.parse(data: docx, name: "fixture.docx", imageDirectory: imageDirectory)
        precondition(parsedWord.sections.count == 1 && parsedWord.sections[0].imageId != nil)
        precondition(parsedWord.sections[0].text.contains("Resilience"))
        let data = NSMutableData()
        let consumer = CGDataConsumer(data: data)!
        var box = CGRect(x: 0, y: 0, width: 600, height: 800)
        let context = CGContext(consumer: consumer, mediaBox: &box, nil)!
        context.beginPDFPage(nil)
        context.textPosition = CGPoint(x: 40, y: 700)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Resilience helps people adapt.", attributes: [.font: NSFont.systemFont(ofSize: 18)]))
        CTLineDraw(line, context)
        context.endPDFPage(); context.beginPDFPage(nil); context.endPDFPage(); context.closePDF()
        let parsedPDF = try DocumentImport.parse(data: data as Data, name: "fixture.pdf", imageDirectory: imageDirectory)
        precondition(parsedPDF.sections.count == 2 && parsedPDF.sections[0].label == "第 1 页")
        precondition(parsedPDF.sections[0].text.contains("Resilience") && parsedPDF.sections[1].imageId != nil)
        // A Word document consisting only of an embedded image remains importable.
        let raster = CGContext(data: nil, width: 200, height: 100, bitsPerComponent: 8, bytesPerRow: 800, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        raster.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        raster.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        let png = NSBitmapImageRep(cgImage: raster.makeImage()!).representation(using: .png, properties: [:])!
        // Build genuine DrawingML: Apple's DOCX exporter silently drops attachments.
        let fixture = imageDirectory.appendingPathComponent("fixture")
        for dir in ["_rels", "word/_rels", "word/media"] { try FileManager.default.createDirectory(at: fixture.appendingPathComponent(dir), withIntermediateDirectories: true) }
        func write(_ name: String, _ value: String) throws { try value.write(to: fixture.appendingPathComponent(name), atomically: true, encoding: .utf8) }
        try png.write(to: fixture.appendingPathComponent("word/media/image.png"))
        try write("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>")
        try write("_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>")
        try write("word/_rels/document.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image.png\"/></Relationships>")
        try write("word/document.xml", """
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="2540000" cy="1270000"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>
        """)
        let zip = Process(); zip.executableURL = URL(fileURLWithPath: "/usr/bin/zip"); zip.currentDirectoryURL = fixture
        let archive = imageDirectory.appendingPathComponent("image.docx")
        zip.arguments = ["-q", "-r", archive.path, "."]; try zip.run(); zip.waitUntilExit()
        precondition(zip.terminationStatus == 0)
        let imageDocx = try Data(contentsOf: archive)
        let imageResult = try DocumentImport.parse(data: imageDocx, name: "image.docx", imageDirectory: imageDirectory)
        precondition(imageResult.sections.count == 1)
        let pageData = try Data(contentsOf: imageDirectory.appendingPathComponent(imageResult.sections[0].imageId! + ".jpg"))
        try pageData.write(to: URL(fileURLWithPath: "/tmp/vibe-word-render-check.jpg"))
        let rendered = NSBitmapImageRep(data: pageData)!.cgImage!
        let pixels = CGContext(data: nil, width: rendered.width, height: rendered.height, bitsPerComponent: 8, bytesPerRow: rendered.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        pixels.draw(rendered, in: CGRect(x: 0, y: 0, width: rendered.width, height: rendered.height))
        let bytes = pixels.data!.assumingMemoryBound(to: UInt8.self)
        var redPixels = 0
        for index in stride(from: 0, to: rendered.width * rendered.height * 4, by: 4) {
            if bytes[index] > 180 && bytes[index + 1] < 80 { redPixels += 1 }
        }
        precondition(redPixels > 10000, "DOCX page screenshot must retain embedded image pixels")
        // Raster-only PDF page has no text but includes the full page image.
        let rasterPDF = PDFDocument(); rasterPDF.insert(PDFPage(image: NSImage(data: png)!)!, at: 0)
        let scan = try DocumentImport.parse(data: rasterPDF.dataRepresentation()!, name: "scan.pdf", imageDirectory: imageDirectory)
        precondition(scan.sections.count == 1 && scan.sections[0].text.isEmpty && scan.sections[0].imageId != nil)
        func rejects(_ input: Data, _ name: String) {
            do { _ = try DocumentImport.parse(data: input, name: name, imageDirectory: imageDirectory); preconditionFailure("Should reject \(name)") } catch { }
        }
        rejects(Data(), "empty.pdf")
        rejects(Data("broken".utf8), "broken.pdf")
        rejects(Data("legacy".utf8), "legacy.doc")
        rejects(Data(repeating: 0, count: DocumentImport.maxBytes + 1), "large.pdf")
        let encrypted = PDFDocument(data: data as Data)!
        let locked = encrypted.dataRepresentation(options: [PDFDocumentWriteOption.ownerPasswordOption: "owner", PDFDocumentWriteOption.userPasswordOption: "password"])!
        rejects(locked, "locked.pdf")
        print("PASS: PDF full-page images, blank/scanned pages, DOCX pagination and embedded-image pixels, malformed/locked/oversize/legacy files")
    }
}
