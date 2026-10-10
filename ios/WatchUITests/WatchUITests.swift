import XCTest

final class WatchUITests: XCTestCase {
    @MainActor
    func testInterfaceLanguageSwitchAndPersistence() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-watch-demo", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["VIBE_WATCH_TEST_STORE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["interfaceLanguage"].firstMatch.tap()
        app.buttons["简体中文"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["手机不在，也能学"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["设置"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["设置"].firstMatch.tap()
        app.buttons["interfaceLanguage"].firstMatch.tap()
        app.buttons["English"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Study without your phone"].waitForExistence(timeout: 5))
        app.buttons["interfaceLanguage"].firstMatch.tap()
        app.buttons["Follow system"].firstMatch.tap()
    }
    @MainActor
    func testReviewAndColdStartPreserveOutboxAndRound() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-watch-demo", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["VIBE_WATCH_TEST_STORE"] = UUID().uuidString
        app.launch()
        let start = app.buttons["startRound"]
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        capture(app, name: "Watch home")
        start.tap()
        let flip = app.buttons["flipCard"]
        XCTAssertTrue(flip.waitForExistence(timeout: 5))
        capture(app, name: "Watch recall")
        flip.tap()
        XCTAssertTrue(app.buttons["grade-4"].isHittable, "评分按钮应固定在小屏底部，不需要先滚动")
        capture(app, name: "Watch answer")
        let again = app.buttons["grade-1"]
        if !again.isHittable { app.swipeUp() }
        XCTAssertTrue(again.waitForExistence(timeout: 5))
        again.tap()
        app.terminate()
        app.launch()
        XCTAssertTrue(flip.waitForExistence(timeout: 15))
        for _ in 0..<5 {
            if !flip.isHittable { app.swipeDown() }
            flip.tap()
            let good = app.buttons["grade-4"]
            for _ in 0..<3 where !good.isHittable { app.swipeUp() }
            XCTAssertTrue(good.waitForExistence(timeout: 5))
            good.tap()
        }
        let result = app.descendants(matching: .any)["roundResult"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        capture(app, name: "Watch round completed")
        let finish = app.buttons["finishRound"]
        if !finish.isHittable { app.swipeUp() }
        finish.tap()
        XCTAssertTrue(app.staticTexts["本机卡片已学完"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["本机卡片已学完"].waitForExistence(timeout: 15))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["6 条记录待同步"].exists)
    }
    @MainActor
    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
