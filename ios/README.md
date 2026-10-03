# Vibe Word 原生 iOS

SwiftUI / iOS 17+ / iPhone、iPad。工程无第三方运行时依赖，和现有 React/Tauri 应用放在同一仓库。

当前原生首版已通过 iOS SDK 构建和 iPhone 模拟器的本地学习/卡片管理流程测试。真实 iCloud 双设备同步与真实模型 API 尚未验收，不能据此宣称已经达到完全一致、可发布的状态。

## 从现有代码确认的功能

| 功能 | 原实现 | iOS 实现 |
| --- | --- | --- |
| 学习 | `src/hooks/useReviewQueue.ts`、`src/lib/sm2.ts` | 随机队列、翻面、四档评分、重来重新入队、完成计数、重新检查；外接键盘 Space / A S D E |
| 调度 | `src/lib/scheduler.ts` | 本地公历日期、每日新卡预算、到期卡不受预算限制；192 组算法样本与 TS 比对 |
| 添加 | `AddCardForm.tsx` | 手动卡片、例句、Markdown 源码编辑及预览 |
| AI 制卡 | `llm.ts`、`generationQueue.ts` | 复用原提示词、英中/中英两张卡、最多 3 并发、取消、重试、结果跳转、完成记录保留 5 分钟 |
| 可选配图 | `llm.ts` | 例句改写 + 图片生成；图片失败仍保存文字；配图内容随卡片同步 |
| 卡片管理 | `CardManager.tsx` | 搜索正面/背面/例句、日期分组折叠、编辑、删除及清理进度、多选、当前搜索结果全选 |
| 导出 | `src/lib/export.ts` | Obsidian `#flashcards`、问号分隔、空行归一；全部搜索结果或选中卡片，保存到 Files |
| 语音 | `src/lib/tts.ts` | 系统 AVSpeechSynthesizer，中英文、单词和例句朗读 |
| 统计 | `StatsBar.tsx`、`ActivityHeatmap.tsx` | 三项计数、26 周热力图、连续/累计天数、复习/新增统计、点击日期详情 |
| 设置 | `SettingsPanel.tsx` | 每日上限、文本 API 和图片 API 独立配置、停用配图、iCloud 状态 |

以运行代码为准的两个细节：

- 队列会随机打乱，已不采用 AGENTS.md 中提到的最逾期优先。
- 手动/AI 新增卡片立即创建 progress，因此会进入到期卡池，并不受“没有 progress 的新卡”预算限制。原生端保留这个行为，没有借移植修改产品规则。

## 打开与签名

### 先用模拟器测试界面

安装完整 Xcode，并在首次启动时安装 iOS Simulator 组件。随后在仓库根目录运行：

```sh
./ios/scripts/run-simulator.sh
```

脚本会构建 Debug 版本、启动可用的 iPhone 模拟器、安装并打开应用，无需先配置开发者签名。通过 `-local-preview` 启动的 Debug 模拟器版本使用独立 `SimulatorPreview.sqlite` 测试库，不访问 CloudKit；设置页会明确显示“模拟器本地预览”。Release 和真机不接受此模式。

支持旧版 Simulator.app 和 Xcode 27 的 Device Hub；Xcode 27 中在 Device Hub 选择已启动的 iPhone 即可操作。

可以依次测试：添加一张手动卡片 → 学习页重新检查 → 翻面并评分 → 卡片页搜索、编辑、朗读和导出 → 重启后确认数据保留。配置自己的 API 后可测试 AI 双向制卡和配图。iCloud 同步仍需以下真实容器与签名设置。

### 测试 iCloud 或真机

1. 安装完整 Xcode 16 或更新版本，打开 `ios/VibeWord.xcodeproj`，选择 `VibeWord` scheme。
2. 在 Signing & Capabilities 选择自己的 Apple Developer Team，并将 Bundle Identifier 改为可用的标识。
3. 在 Build Settings 中将 `CLOUDKIT_CONTAINER` 改成你创建的容器标识。默认占位值为 `iCloud.com.lianyun.vibeword`，并不表示该容器已在开发者账户中创建。
4. 确认 iCloud / CloudKit、Push Notifications、Background Modes / Remote notifications 能力和 provisioning profile 匹配。Info.plist 和 entitlements 都引用上述容器变量。
5. 初次调试可在 scheme 的启动参数加入 `-initializeCloudKitSchema`，登录 iCloud 后运行一次。该初始化仅在 Debug 编译中存在；完成后移除此参数。
6. 用 CloudKit Console 检查 `SyncEvent` 对应类型及加密 payload 字段。分发 TestFlight 前将 Development schema 部署到 Production，并在两台同账户真机上验收。

命令行构建（需要完整 Xcode / iOS SDK）：

```sh
xcodebuild -project ios/VibeWord.xcodeproj -scheme VibeWord \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

增加或删除 Swift 文件后，用 `python3 ios/scripts/generate-project.py` 重建工程。脚本会重置工程中的默认签名设置，执行后重新确认 Team、Bundle ID 和容器。

## 同步设计与边界

- 数据保存在 Core Data 本地 SQLite，`NSPersistentCloudKitContainer` 自动镜像到当前用户的 **private database**；没有自建服务器。
- 卡片、进度、设置（包括 API Key）、每日学习记录均编码到加密的 binary payload。大字段允许 external binary storage，以供 Core Data/CloudKit 管理图片数据。iOS 本地文件使用首次解锁后保护。
- 每次修改保存独立不可变记录，以 UUID 去重。卡片编辑、进度和单项设置按时间戳排序、同时间戳用 UUID 排序，结果在导入顺序不同时保持一致。不同卡片、不同设备的复习次数不会被整库覆盖吞掉。
- 删除使用永久记录，优先于同卡片的后续旧设备编辑或评分；同时从投影中移除进度。不会物理清除用于统计的历史活动。
- 同一卡片同时离线学习时，次数会累加，最终排程采用时间排序后的最后一条进度；不会把两个独立 SM-2 状态相加。设备时钟有误会影响最后写入者判断。离线设备无法严格执行跨设备全局每日额度，合并后按卡片去重统计已发放数量。
- 两张 AI 卡片和它们的初始进度一次本地事务写入。CloudKit 远端传播为最终一致，跨记录到达期间 UI 可能短暂看到部分数据。
- 本地写入不等待网络。无 iCloud、离线、配额不足或权限错误时保留本地数据并显示同步状态；同步重试由系统管理。“检查状态”只检查账号，不保证立即同步。最近同步活动并不表示所有设备已经一致。
- 用户长时间使用后，历史事件会增长，目前每次刷新会重建投影。未做自动删除或压缩历史，以免破坏其他离线设备的合并与统计。
- 当前只接入新 iOS/iPadOS 客户端。**现有 Tauri/macOS SQLite 和浏览器 localStorage 尚未接入此容器，也没有自动导入既有桌面数据。** 双向桌面同步需要单独实现桌面桥接。

Apple 官方依据：[Core Data + CloudKit](https://developer.apple.com/documentation/coredata/setting-up-core-data-with-cloudkit)、[加密属性](https://developer.apple.com/documentation/coredata/nsattributedescription/allowscloudencryption)、[系统同步时机](https://developer.apple.com/documentation/technotes/tn3163-understanding-the-synchronization-of-nspersistentcloudkitcontainer)。

## 验证

```sh
# 在仓库根目录；由真实 TypeScript 实现生成样本
node ios/scripts/generate-fixtures.mjs
# CLT 也能运行：编译并执行同一批 XCTest 方法的轻量断言适配版
ios/scripts/test-core.sh
# 完整 Xcode 环境的常规测试入口
swift test --package-path ios
# UI 测试；将设备名替换为本机可用的 iPhone
xcodebuild -project ios/VibeWord.xcodeproj -scheme VibeWord \
  -destination 'platform=iOS Simulator,name=iPhone Air' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO \
  -parallel-testing-enabled NO test
```

2026-10-01，Xcode 27.0 / iPhone Air / iOS 27.0 实测：

- Debug iOS Simulator 构建、安装、启动成功；修复启动脚本对旧 Simulator.app 路径的依赖。
- 标准 `swift test`：8 项核心测试，0 失败（含 192 组 TS SM-2 样本）。
- XCUITest：1 个完整用户流程，0 失败，覆盖填写正面/Markdown/例句、保存、卡片显示、翻面、重来、良好、完成计数、冷启动后卡片保留、编辑保存、删除及删除后冷启动、设置页本地模式提示。
- 修复输入后键盘挡住标签栏的操作问题：新增“完成输入”工具栏、交互式收键盘、添加成功后自动结束输入。
- UI 测试通过 `VIBE_TEST_STORE` 的 UUID 选择独立持久化测试库，仅 Debug 模拟器本地模式识别该变量，不影响普通预览库或 iCloud 数据。
- 结果文件：`/tmp/vibe-ios-ui-tests-5.xcresult`；核心测试日志：`/tmp/vibe-ios-core-tests.log`。临时路径可能被系统清理，可用上述命令复现。

2026-09-30 已完成：

- 8 个 Swift 核心测试方法通过，包括 192 组 TS SM-2 比对、导出格式、日期边界、额度、离线合并、重复导入、删除优先和配置冲突。
- Swift 核心、Persistence、AppStore 在本机 macOS SDK 类型检查通过；全部 Swift 文件语法解析通过。
- Xcode 工程、Info.plist、entitlements 的 plist 校验通过；原项目 `npm run typecheck` 通过。
- 当时只有 CLT，没有 XCTest，使用同一份测试方法的轻量断言适配入口；现已在完整 Xcode 中通过标准 XCTest。

还需完成的验收：

- iPad、多尺寸与 VoiceOver、朗读、系统文件导出、真实 API/配图/网络取消测试；本次 UI 自动测试没有覆盖这些操作。
- 同账户两台设备互传卡片、图片、API 配置；离线双端评分与删除；杀进程重启、iCloud 配额满、退出/切换 Apple 账户、Production schema 同步。换账户前不要假定本地数据会自动隔离或清除，应先验证产品所需行为。
- Markdown 使用原生文本编辑加预览，当前支持常用标题、强调、链接、图片、引用、无序列表；不是桌面 Milkdown 的所见即所得编辑器，复杂嵌套 Markdown 的视觉呈现尚不完全相同。
- iOS 后台执行受系统限制，生成任务仅在进程存活期间保留，不能保证锁屏后一直执行；失败可重试。原桌面队列同样不跨重启持久化。
- 保留 HTTP 兼容 API 能力（如局域网 Ollama），Info.plist 因此允许任意网络请求；生产分发需按照实际支持的服务评估 ATS 设置。

这些限制与未验证项在完成前，不能把本次交付视为“功能完全一致”的最终验收。
