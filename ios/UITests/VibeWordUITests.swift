import XCTest

final class VibeWordUITests: XCTestCase {
    @MainActor
    func testCardLifecycleAndPersistence() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["添加"].waitForExistence(timeout: 20))
        app.tabBars.buttons["添加"].tap()
        let front = app.descendants(matching: .any).matching(identifier: "add.front").firstMatch
        XCTAssertTrue(front.waitForExistence(timeout: 10))
        front.tap(); front.typeText("serendipity")
        let editor = app.textViews["markdown.editor"]
        editor.tap(); editor.typeText("A happy discovery. **Unexpected joy.**")
        let example = app.descendants(matching: .any).matching(identifier: "add.example").firstMatch
        example.tap(); example.typeText("Finding this cafe was pure serendipity.")
        app.buttons["完成输入"].tap()
        app.buttons["手动添加"].tap()
        XCTAssertTrue(app.staticTexts["已添加：serendipity"].waitForExistence(timeout: 10))

        app.tabBars.buttons["卡片"].tap()
        reveal(app.staticTexts["serendipity"], in: app)
        app.tabBars.buttons["学习"].tap()
        XCTAssertTrue(app.buttons["点击查看释义"].waitForExistence(timeout: 10))
        app.buttons["点击查看释义"].tap()
        XCTAssertTrue(app.buttons["良好"].waitForExistence(timeout: 5))
        app.buttons["重来"].tap()
        XCTAssertTrue(app.buttons["点击查看释义"].waitForExistence(timeout: 5))
        app.buttons["点击查看释义"].tap()
        app.buttons["良好"].tap()
        XCTAssertTrue(app.staticTexts["今日学习完成"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["共完成 1 张，其中重学 1 次。明天见。"].exists)

        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["卡片"].waitForExistence(timeout: 15))
        app.tabBars.buttons["卡片"].tap()
        reveal(app.staticTexts["serendipity"], in: app)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Cards after relaunch"; shot.lifetime = .keepAlways
        add(shot)

        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["编辑卡片"].waitForExistence(timeout: 5))
        let edit = app.textViews["markdown.editor"]
        edit.tap(); edit.typeText(" Verified on iOS.")
        app.buttons["保存"].tap()
        XCTAssertFalse(app.navigationBars["编辑卡片"].exists)
        app.buttons["删除"].firstMatch.tap()
        let confirmDelete = try XCTUnwrap(app.buttons.matching(identifier: "删除").allElementsBoundByIndex.last(where: { $0.isHittable }))
        confirmDelete.tap()
        XCTAssertTrue(app.staticTexts["还没有卡片，去添加第一个单词吧。"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["卡片"].waitForExistence(timeout: 15))
        app.tabBars.buttons["卡片"].tap()
        XCTAssertTrue(app.staticTexts["还没有卡片，去添加第一个单词吧。"].waitForExistence(timeout: 5))
        app.tabBars.buttons["设置"].tap()
        reveal(app.staticTexts["模拟器本地预览 · 未启用 iCloud"], in: app)
    }
    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<7 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists, app.debugDescription)
    }

}
