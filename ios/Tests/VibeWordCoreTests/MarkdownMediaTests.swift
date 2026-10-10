import XCTest
@testable import VibeWordCore

final class MarkdownMediaTests: XCTestCase {
    func testInlineImportedAudioKeepsSurroundingMarkdown() {
        let audio = #"<audio controls preload="none" src="data:audio/mpeg;base64,//NkAAAA"></audio>"#
        XCTAssertEqual(MarkdownMedia.parts("**example** " + audio + " after"), [
            .text("**example** "), .audio(audio), .text(" after")
        ])
    }

    func testMultipleAndMultilineAudio() {
        let first = "<AUDIO controls>\n<source src='data:audio/wav;base64,AAAA'>\n</AUDIO>"
        let second = "<audio controls src='data:audio/mpeg;base64,BBBB'></audio>"
        XCTAssertEqual(MarkdownMedia.parts(first + "\n" + second), [.audio(first), .text("\n"), .audio(second)])
    }

    func testReadingDoesNotSplitAudioAtBlankLines() {
        let audio = "<audio controls>\n\n<source src='data:audio/wav;base64,AAAA'>\n</audio>"
        XCTAssertEqual(MarkdownMedia.readingBlocks("Before\n\n" + audio + "After"), ["Before", "", audio, "After"])
    }

    func testOrdinaryMarkdownIsUnchanged() {
        let text = "# Title\n![image](data:image/png;base64,AAAA)\n**definition**"
        XCTAssertEqual(MarkdownMedia.parts(text), [.text(text)])
    }
}
