import XCTest
@testable import VibeWordCore

final class LocalizationTests: XCTestCase {
    func testSystemResolutionAndExplicitOverride() {
        XCTAssertEqual(AppLanguage.resolve("system", languages: ["zh-Hant-TW", "en"]), "zh-Hans")
        XCTAssertEqual(AppLanguage.resolve("system", languages: ["en-GB", "zh-Hans"]), "en")
        XCTAssertEqual(AppLanguage.resolve("system", languages: ["fr-FR"]), "en")
        XCTAssertEqual(AppLanguage.resolve("invalid", languages: ["zh-Hans"]), "zh-Hans")
        XCTAssertEqual(AppLanguage.resolve("en", languages: ["zh-Hans"]), "en")
        XCTAssertEqual(AppLanguage.resolve("zh-Hans", languages: ["en-US"]), "zh-Hans")
    }
    func testInterpolationKeepsUserContentAndStatusTranslation() {
        let defaults = AppLanguage.defaults, old = defaults.object(forKey: AppLanguage.key)
        defer { if let old { defaults.set(old, forKey: AppLanguage.key) } else { defaults.removeObject(forKey: AppLanguage.key) } }
        defaults.set("en", forKey: AppLanguage.key)
        XCTAssertEqual(L("已添加：{0}", "中文 {1}"), "Added: 中文 {1}")
        XCTAssertEqual(L("共完成 {0} 张，其中重学 {1} 次。明天见。", "3", "2"), "Completed 3 cards with 2 relearning attempts. See you tomorrow.")
        XCTAssertEqual(localizedMessage("已连接 My Folder；等待同步"), "Connected to My Folder; waiting to sync")
        XCTAssertEqual(localizedMessage("文件已合并并写入同步目录；iCloud 传输由系统处理"), "Files merged and saved to the sync folder. The system manages iCloud transfers.")
        defaults.set("zh-Hans", forKey: AppLanguage.key)
        XCTAssertEqual(L("设置"), "设置")
        XCTAssertEqual(L("已添加：{0}", "word"), "已添加：word")
    }
}
