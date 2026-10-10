import XCTest

final class VibeWordUITests: XCTestCase {
    @MainActor
    func testAITaskReviewAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-vibe-word.interface-language", "zh-Hans"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launchEnvironment["VIBE_TEST_AI_TASKS"] = #"{"version":1,"tasks":[{"id":"fixture-task","kind":"word","word":"queue-word","requirements":"Review fixture","status":"review","enqueuedAt":1,"drafts":[{"id":"one","direction":"enToCn","card":{"id":"custom:ai:one","front":"queue-word","back":"Draft answer","noteId":"pair"},"status":"ready","revision":0},{"id":"two","direction":"cnToEn","card":{"id":"custom:ai:two","front":"Reverse question","back":"queue-word","noteId":"pair"},"status":"ready","revision":0}]}]}"#
        app.launch()
        let queue = app.tabBars.buttons["任务队列"]
        XCTAssertTrue(queue.waitForExistence(timeout: 20)); queue.tap()
        app.staticTexts["ai.draft.one"].tap()
        let confirm = app.buttons["ai.confirm"]
        reveal(confirm, in: app)
        XCTAssertTrue(confirm.isHittable)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "AI draft review"; screenshot.lifetime = .keepAlways; add(screenshot)
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Reverse question"].waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["任务队列"].waitForExistence(timeout: 20)); app.tabBars.buttons["任务队列"].tap()
        XCTAssertTrue(app.staticTexts["ai.draft.two"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["ai.draft.one"].exists)
        app.staticTexts["ai.draft.two"].tap()
        let discard = app.buttons["丢弃草稿"]
        reveal(discard, in: app); discard.tap()
        XCTAssertFalse(app.buttons["ai.confirm"].waitForExistence(timeout: 2))
    }

    @MainActor
    func testSavedAndTemporaryTagStudyScopes() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-vibe-word.interface-language", "zh-Hans"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launchEnvironment["VIBE_TEST_CARDS"] = #"[{"id":"a","front":"work-one","back":"Answer","tags":["work"]},{"id":"b","front":"work-two","back":"Answer","tags":["work","travel"]},{"id":"c","front":"travel-only","back":"Answer","tags":["travel"]},{"id":"d","front":"untagged","back":"Answer"}]"#
        app.launch()
        XCTAssertTrue(app.buttons["cards.tagStudy"].waitForExistence(timeout: 20))
        app.buttons["open.settings"].tap()
        let mode = app.switches["settings.tagScope"]
        reveal(mode, in: app); mode.switches.firstMatch.tap()
        let work = app.switches["tags.option.work"]
        reveal(work, in: app); work.switches.firstMatch.tap()
        app.buttons["settings.save"].tap()
        app.buttons["settings.close"].tap()
        XCTAssertEqual(app.staticTexts["cards.studyScope"].label, "学习范围：work")
        app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.staticTexts["study.scope"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["study.scope"].label, "学习范围：work")
        let card = app.descendants(matching: .any)["study.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertTrue(["work-one", "work-two"].contains(card.value as? String ?? ""))
        app.buttons["study.exit"].tap()
        app.buttons["cards.tagStudy"].tap()
        XCTAssertTrue(app.buttons["tags.start"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.switches["tags.option.work"].value as? String, "1")
        app.buttons["tags.clear"].tap()
        XCTAssertFalse(app.buttons["tags.start"].isEnabled)
        app.switches["tags.option.untagged"].switches.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["tags.preview"].label.contains("新卡 1 张"))
        app.buttons["tags.start"].tap()
        if app.buttons["开始新的复习"].waitForExistence(timeout: 2) { app.buttons["开始新的复习"].tap() }
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertEqual(card.value as? String, "untagged")
        app.buttons["study.exit"].tap()
        XCTAssertTrue(app.buttons["tags.start"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.switches["tags.option.untagged"].value as? String, "1")
        app.buttons["关闭"].tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["open.settings"].waitForExistence(timeout: 20))
        app.buttons["open.settings"].tap()
        let restoredWork = app.switches["tags.option.work"]
        reveal(restoredWork, in: app)
        XCTAssertEqual(restoredWork.value as? String, "1")
        XCTAssertEqual(app.switches["tags.option.untagged"].value as? String, "0")
    }

    @MainActor
    func testQuickLearningFlipSwipeAndTagSelection() throws {
        let app = launchRedesign()
        app.tabBars.buttons["卡片"].tap()
        app.buttons["卡片工具"].tap()
        app.buttons["cards.quickLearning"].tap()
        XCTAssertTrue(app.buttons["quick.start"].waitForExistence(timeout: 5))
        app.buttons["quick.start"].tap()
        let card = app.descendants(matching: .any)["quick.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let first = card.value as? String
        card.tap()
        XCTAssertNotEqual(card.value as? String, first)
        app.swipeLeft()
        XCTAssertEqual(app.staticTexts["quick.position"].label, "2 / 2")
        app.buttons["返回我的卡片"].tap()
        app.tabBars.buttons["复习"].tap()
        app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.staticTexts["已完成 0，共 2 张"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testSimplifiedIOSFeatures() throws {
        let app = launchRedesign()
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        app.tabBars.buttons["卡片"].tap()
        app.buttons["cards.add"].tap()
        XCTAssertTrue(app.buttons["add.generate"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["add.importJSON"].exists)
        let input = app.descendants(matching: .any)["add.front"].firstMatch
        input.tap(); input.typeText("hello")
        app.buttons["完成输入"].tap()
        XCTAssertFalse(app.buttons["add.generate"].isEnabled)
        app.buttons["关闭"].tap()
        app.tabBars.buttons["复习"].tap()
        app.buttons["open.settings"].tap()
        reveal(app.staticTexts["模型配置仅供查看，请在桌面端修改后通过 iCloud 同步。"], in: app)
        XCTAssertEqual(app.secureTextFields.count, 0)
        XCTAssertFalse(app.buttons["settings.save"].exists)
    }

    @MainActor
    func testUnifiedSettingsAndDraftRecovery() throws {
        let app = launchRedesign()
        app.buttons["open.settings"].tap()
        let stepper = app.steppers["settings.limit"]
        XCTAssertTrue(stepper.waitForExistence(timeout: 5))
        let original = stepper.label
        stepper.buttons.element(boundBy: 1).tap()
        app.buttons["settings.close"].tap()
        XCTAssertTrue(app.buttons["继续编辑"].waitForExistence(timeout: 5))
        app.buttons["继续编辑"].tap()
        XCTAssertTrue(app.buttons["settings.save"].isEnabled)
        app.buttons["settings.close"].tap()
        app.buttons["放弃修改"].tap()
        app.buttons["open.settings"].tap()
        XCTAssertEqual(stepper.label, original)
        stepper.buttons.element(boundBy: 1).tap()
        let saved = stepper.label
        app.buttons["settings.close"].tap()
        app.buttons["保存并离开"].tap()
        app.buttons["open.settings"].tap()
        XCTAssertEqual(stepper.label, saved)
        stepper.buttons.element(boundBy: 1).tap()
        let draft = stepper.label
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["settings.save"].waitForExistence(timeout: 20))
        XCTAssertEqual(stepper.label, draft)
        app.buttons["settings.close"].tap()
        app.buttons["放弃修改"].tap()
        app.buttons["open.settings"].tap()
        XCTAssertEqual(stepper.label, saved)
    }
    @MainActor
    func testInterfaceLanguageSwitchAndPersistence() throws {
        let app = launchRedesign(language: "en")
        app.buttons["open.settings"].tap()
        app.buttons["interfaceLanguage"].tap()
        app.buttons["简体中文"].tap()
        app.buttons["settings.save"].tap()
        XCTAssertTrue(app.staticTexts["学习设置"].waitForExistence(timeout: 5))
        app.buttons["settings.close"].tap()
        XCTAssertTrue(app.tabBars.buttons["复习"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["复习"].waitForExistence(timeout: 20))
        app.buttons["open.settings"].tap()
        app.buttons["interfaceLanguage"].tap(); app.buttons["English"].tap()
        app.buttons["settings.save"].tap()
        XCTAssertTrue(app.staticTexts["Study settings"].waitForExistence(timeout: 5))
        app.buttons["settings.close"].tap()
        XCTAssertTrue(app.tabBars.buttons["Reviews"].exists)
    }
    @MainActor
    func testCardLifecycleAndPersistence() throws {
        let app = launchRedesign()
        app.tabBars.buttons["卡片"].tap()
        app.buttons["library.card.a"].tap()
        XCTAssertTrue(app.staticTexts["Definition of alpha"].waitForExistence(timeout: 5))
        app.buttons["阅读工具"].tap(); app.buttons["编辑内容"].tap()
        let editor = app.textViews["markdown.editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText(" Verified on iOS.")
        app.buttons["保存"].tap()
        app.terminate(); app.launch()
        app.tabBars.buttons["卡片"].tap()
        app.buttons["cards.continueReading"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Verified on iOS.")).firstMatch.waitForExistence(timeout: 5))
        app.buttons["阅读工具"].tap(); app.buttons["删除"].tap()
        app.buttons["删除"].tap()
        XCTAssertTrue(app.staticTexts["Definition of beta"].waitForExistence(timeout: 5))
        app.terminate(); app.launch(); app.tabBars.buttons["卡片"].tap()
        XCTAssertFalse(app.buttons["library.card.a"].exists)
        XCTAssertTrue(app.buttons["library.card.b"].exists)
    }
    @MainActor
    func testBrowseDoesNotGradeAndTapFlips() throws {
        let app = launchRedesign()
        capture(app, "01 Review home")
        app.tabBars.buttons["卡片"].tap()
        capture(app, "02 Library")
        app.buttons["library.card.a"].tap()
        XCTAssertTrue(app.staticTexts["Definition of alpha"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["study.grade.5"].exists)
        app.buttons["reading.next"].tap()
        XCTAssertTrue(app.staticTexts["Definition of beta"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["reading.next"].isEnabled)
        capture(app, "03 Reading")
        app.terminate(); app.launch()
        app.tabBars.buttons["卡片"].tap()
        app.buttons["cards.continueReading"].tap()
        XCTAssertTrue(app.staticTexts["Definition of beta"].waitForExistence(timeout: 5))
        app.tabBars.buttons["复习"].tap()
        app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.staticTexts["已完成 0，共 2 张"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["study.reveal"].exists)
        XCTAssertTrue(app.buttons["study.grade.5"].isEnabled)
        capture(app, "04 Recall")
        app.descendants(matching: .any)["study.card"].firstMatch.tap()
        XCTAssertTrue(app.buttons["study.grade.5"].isEnabled)
        capture(app, "05 Answer")
        app.buttons["study.grade.5"].tap()
        XCTAssertTrue(app.staticTexts["已完成 1，共 2 张"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["cards.startStudy"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.buttons["cards.startStudy"].label, "继续复习")
        app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.staticTexts["已完成 1，共 2 张"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testStudyTapSwipeAndGradeWithoutRevealing() throws {
        continueAfterFailure = false
        let app = launchRedesign()
        app.buttons["cards.startStudy"].tap()
        let card = app.descendants(matching: .any)["study.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let front = try XCTUnwrap(card.value as? String)
        for quality in [1, 3, 4, 5] {
            XCTAssertTrue(app.buttons["study.grade.\(quality)"].isHittable)
            XCTAssertTrue(app.buttons["study.grade.\(quality)"].isEnabled)
        }
        // Tap away from the speaker and embedded content controls.
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.85)).tap()
        XCTAssertTrue(waitForValue(card, front == "alpha" ? "Definition of alpha" : "Definition of beta"))
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.85)).tap()
        XCTAssertTrue(waitForValue(card, front))
        card.swipeLeft()
        let next = try XCTUnwrap(card.value as? String)
        XCTAssertNotEqual(next, front)
        XCTAssertTrue(["alpha", "beta"].contains(next))
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.85)).tap()
        XCTAssertTrue(waitForValue(card, next == "alpha" ? "Definition of alpha" : "Definition of beta"))
        card.swipeRight()
        XCTAssertTrue(waitForValue(card, front))
        XCTAssertTrue(app.staticTexts["已完成 0，共 2 张"].exists)
        app.buttons["study.grade.5"].tap()
        XCTAssertTrue(app.staticTexts["已完成 1，共 2 张"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForValue(card, next))
        XCTAssertTrue(app.buttons["study.grade.5"].isEnabled)
    }

    @MainActor
    private func waitForValue(_ element: XCUIElement, _ value: String) -> Bool {
        XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)], timeout: 5) == .completed
    }

    @MainActor
    func testStudySwipeExcludesWaitingCards() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-vibe-word.interface-language", "zh-Hans"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launchEnvironment["VIBE_TEST_CARDS"] = #"[{"id":"custom:swipe-a","front":"alpha","back":"Answer alpha"},{"id":"custom:swipe-b","front":"beta","back":"Answer beta"}]"#
        app.launch()
        XCTAssertTrue(app.buttons["cards.startStudy"].waitForExistence(timeout: 20))
        app.buttons["cards.startStudy"].tap()
        let card = app.descendants(matching: .any)["study.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let first = card.value as? String
        app.descendants(matching: .any)["study.card"].firstMatch.tap()
        app.buttons["study.grade.1"].tap()
        let remaining = card.value as? String
        XCTAssertNotEqual(remaining, first)
        app.swipeLeft()
        XCTAssertEqual(card.value as? String, remaining)
        app.swipeRight()
        XCTAssertEqual(card.value as? String, remaining)
        XCTAssertTrue(app.descendants(matching: .any)["已完成 0，共 2 张"].firstMatch.exists)
        app.descendants(matching: .any)["study.card"].firstMatch.tap()
        app.buttons["study.grade.5"].tap()
        XCTAssertTrue(app.staticTexts["等待重学"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testSettingsLayoutAndBottomSave() throws {
        let app = launchRedesign(language: "en")
        app.buttons["open.settings"].tap()
        XCTAssertFalse(app.buttons["settings.save"].exists)
        app.steppers["settings.limit"].buttons.element(boundBy: 1).tap()
        let save = app.buttons["settings.save"]
        XCTAssertTrue(save.isHittable)
        XCTAssertEqual(save.label, "Save")
        XCTAssertGreaterThan(save.frame.minY, app.frame.midY)
        XCTAssertLessThan(save.frame.maxY, app.frame.maxY)
        capture(app, "06 Settings draft")
        save.tap()
        let model = app.descendants(matching: .any)["settings.textModel"].firstMatch
        reveal(model, in: app); model.tap()
        reveal(app.staticTexts["API Key"], in: app)
        XCTAssertEqual(app.textFields.count, 0)
        XCTAssertEqual(app.secureTextFields.count, 0)
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

extension VibeWordUITests {
    @MainActor
    func testStudyToolsAheadAndDurableRelearning() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-vibe-word.interface-language", "zh-Hans"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launchEnvironment["VIBE_TEST_CARDS"] = #"[{"id": "custom:test-aheadword", "front": "aheadword", "back": "A durable review"}]"#
        app.launch()
        XCTAssertTrue(app.buttons["cards.startStudy"].waitForExistence(timeout: 20))
        app.buttons["cards.startStudy"].tap()
        let card = app.descendants(matching: .any)["study.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10)); app.descendants(matching: .any)["study.card"].firstMatch.tap()
        app.buttons["study.grade.5"].tap()
        XCTAssertTrue(app.buttons["study.undo"].isEnabled)
        app.buttons["study.undo"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5)); app.descendants(matching: .any)["study.card"].firstMatch.tap(); app.buttons["study.grade.5"].tap()
        app.buttons["study.exit"].tap()
        app.buttons["review.ahead"].tap()
        XCTAssertTrue(app.buttons["开始提前学习"].waitForExistence(timeout: 5))
        app.buttons["5 天"].tap()
        XCTAssertTrue(app.buttons["开始提前学习"].isEnabled)
        app.buttons["开始提前学习"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5)); app.descendants(matching: .any)["study.card"].firstMatch.tap()
        app.buttons["study.grade.1"].tap()
        XCTAssertTrue(app.staticTexts["等待重学"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["cards.startStudy"].waitForExistence(timeout: 20))
        app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.staticTexts["等待重学"].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Durable relearning"; shot.lifetime = .keepAlways; add(shot)
    }
}


extension VibeWordUITests {
    @MainActor
    private func launchRedesign(language: String = "zh-Hans") -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(\(language))", "-AppleLocale", language == "en" ? "en_US" : "zh_CN"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        app.launchEnvironment["VIBE_TEST_CARDS"] = #"[{"id":"a","front":"alpha","back":"Definition of alpha","createdAt":1791100000},{"id":"b","front":"beta","back":"Definition of beta","createdAt":1791090000}]"#
        app.launch()
        XCTAssertTrue(app.buttons["cards.startStudy"].waitForExistence(timeout: 20))
        if !app.tabBars.buttons[language == "en" ? "Reviews" : "复习"].exists {
            app.buttons["open.settings"].tap()
            app.buttons["interfaceLanguage"].tap()
            app.buttons[language == "en" ? "English" : "简体中文"].tap()
            app.buttons["settings.save"].tap(); app.buttons["settings.close"].tap()
        }
        return app
    }
    @MainActor
    private func capture(_ app: XCUIApplication, _ title: String) {
        let screenshot = app.screenshot()
        let shot = XCTAttachment(screenshot: screenshot); shot.name = title; shot.lifetime = .keepAlways; add(shot)
        let path = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(title + ".png")
        do { try screenshot.pngRepresentation.write(to: path); print("UI_SCREENSHOT: " + path.path) } catch { XCTFail(error.localizedDescription) }
    }
}


extension VibeWordUITests {
    @MainActor
    func testLongReadingRestoresParagraphAndAccessibleReview() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-local-preview", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-vibe-word.interface-language", "zh-Hans"]
        app.launchEnvironment["VIBE_TEST_STORE"] = UUID().uuidString
        let text = (1...24).map { "Paragraph \($0). Reading a long definition should remain comfortable, and returning to it should keep your place." }.joined(separator: "\n\n")
        let data = try JSONSerialization.data(withJSONObject: [["id": "long", "front": "resilient", "back": text]])
        app.launchEnvironment["VIBE_TEST_CARDS"] = String(decoding: data, as: UTF8.self)
        app.launch()
        XCTAssertTrue(app.buttons["卡片"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        app.buttons["卡片"].firstMatch.tap()
        app.buttons["library.card.long"].tap()
        let scroll = app.scrollViews["reading.content"]
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        for _ in 0..<3 { scroll.swipeUp() }
        let visible = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Paragraph '")).allElementsBoundByIndex.first { $0.isHittable && $0.frame.minY > 100 }
        let paragraph = try XCTUnwrap(visible?.label)
        capture(app, "07 Large text reading")
        app.terminate(); app.launch()
        app.buttons["卡片"].firstMatch.tap()
        app.buttons["cards.continueReading"].tap()
        XCTAssertTrue(app.staticTexts[paragraph].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[paragraph].isHittable)
        app.buttons["复习"].firstMatch.tap(); app.buttons["cards.startStudy"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["study.card"].firstMatch.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["study.card"].firstMatch.tap()
        XCTAssertTrue(app.buttons["study.grade.5"].isHittable)
        XCTAssertTrue(app.buttons["study.grade.1"].isHittable)
        XCTAssertGreaterThan(app.scrollViews["study.content"].frame.height, app.frame.height * 0.25, "Large controls must leave enough space to read the answer")
        capture(app, "08 Accessible answer")
    }
}
