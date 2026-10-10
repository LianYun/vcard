# Vibe Word 原生 iOS

SwiftUI / iOS 17+ / iPhone、iPad。工程无第三方运行时依赖，和现有 React/Tauri 应用放在同一仓库。

当前原生首版已通过 iOS SDK 构建和 iPhone 模拟器的本地学习/卡片管理流程测试。真实 iCloud 双设备同步与真实模型 API 尚未验收，不能据此宣称已经达到完全一致、可发布的状态。

## iOS 复习与阅读布局（2026-10-04）

一级导航为「复习 / 卡片」。复习首页显示当前任务、继续会话、就地范围选择、提前复习及近 7 天记录；卡片页提供搜索、标签/状态筛选、排序、批量选择和独立阅读详情。iPad 使用列表与阅读双栏。

- 添加由卡片页 `＋` 打开，生成任务继续由 AppStore 管理，结果入口留在卡片页。
- 设置由复习页齿轮或卡片工具菜单打开。未保存时拦截关闭并提供保存、放弃、继续编辑；本机草稿继续跨重启保留。备份与恢复移到设置，学习统计留在复习页。
- 正式复习支持点击卡片切换正反面，也可用底部按钮或空格翻面；四档评分与算法计算的间隔始终显示，无需揭晓即可评分并前进。左右滑动在当前可学习队列中浏览，切换后显示正面，浏览不产生评分，等待重学的卡片暂不参与切换；显式跳过和撤销保留。
- 阅读同时展示正面、正文和例句，支持标记、朗读、字号、编辑，以及沿当前结果上一张/下一张；阅读不写入评分或新卡额度。
- 本机 `reading-state.json` 保存阅读卡片、结果集、正文段落位置及字号；`study-session.json` 保存当天未完成队列与已完成计数。这两份文件不作为同步事件上传。跨天重新计算任务；恢复时丢弃已删除、不可用或评分状态已变化的队列项。撤销记录不跨重启恢复。
- 已有的学习算法、事件格式、iCloud 和 Watch 同步沿用原实现。

交互设计稿：[ios-review-reading.html](../design/ios-review-reading.html)，通过 MCP 同步到既有 iPhone 设计项目的新 artifact，保留原学习页稿件。设计数据为演示，真实布局以 SwiftUI 和模拟器截图为准。

### 本次改版验证

- Xcode iOS Simulator 构建通过；Swift 核心测试 38 项通过，包含会话恢复过滤删除/暂停/其他设备评分变更及跨天失效。
- iPhone 18 Pro / iOS 27：11 项 UI 用例分别通过（完整回归后，修正英文标签断言并定向复跑语言、大字号与阅读用例）。覆盖阅读不评分、编辑删除、翻卡浏览、正式评分/重学/撤销、提前复习、标签范围、冷启动续学、设置保存/放弃/草稿与语言切换。
- iPad Pro 11-inch / iOS 27：双栏长文阅读、段落位置恢复和最大辅助字号评分通过。大字号用例还验证评分区不挤掉正文可读区域。
- `node scripts/test-localization.mjs`：翻译覆盖、占位符、中英文切换与原生 UI 覆盖通过。
- 真实模型请求、真实多设备 iCloud 同步及完整 VoiceOver 操作不属于本次模拟器验收。

## 从现有代码确认的功能

| 功能 | 原实现 | iOS 实现 |
| --- | --- | --- |
| 学习 | `src/hooks/useReviewQueue.ts`、`src/lib/sm2.ts` | 揭晓答案、四档评分、重学等待、完成计数、重新检查、当天会话恢复；外接键盘 Space / A S D E |
| 调度 | `src/lib/scheduler.ts` | 本地公历日期、每日新卡预算、到期卡不受预算限制；192 组算法样本与 TS 比对 |
| 添加 | `AddCardForm.tsx` | 仅支持 AI 添加；已有卡片仍可编辑 |
| AI 制卡 | `llm.ts`、`generationQueue.ts` | 复用原提示词、英中/中英两张卡、最多 3 并发、取消、重试、结果跳转、完成记录保留 5 分钟 |
| 可选配图 | `llm.ts` | 例句改写 + 图片生成；图片失败仍保存文字；配图内容随卡片同步 |
| 卡片管理 | `CardManager.tsx` | 搜索正面/背面/例句、标签/状态筛选、标题/时间排序、阅读详情、编辑、删除及清理进度、多选、当前结果全选 |
| 卡片交换 | 桌面端支持导入导出 | iOS 不提供 JSON 导入导出，通过 iCloud 同步卡片 |
| 语音 | `src/lib/tts.ts` | 系统 AVSpeechSynthesizer，中英文、单词和例句朗读 |
| 统计 | `StatsBar.tsx`、`ActivityHeatmap.tsx` | 首页任务计数、近 7 天记录；详情保留 26 周热力图、连续/累计天数、复习/新增统计、日期详情 |
| 设置 | `SettingsPanel.tsx` | 每日上限、文本和图片模型只读展示（API Key 隐藏）、iCloud 状态 |

以运行代码为准的两个细节：

- 队列会随机打乱，已不采用 AGENTS.md 中提到的最逾期优先。
- AI 新增卡片立即创建 progress，因此会进入到期卡池，并不受“没有 progress 的新卡”预算限制。原生端保留这个行为，没有借移植修改产品规则。

## 打开与签名

### 先用模拟器测试界面

安装完整 Xcode，并在首次启动时安装 iOS Simulator 组件。随后在仓库根目录运行：

```sh
./ios/scripts/run-simulator.sh
```

脚本会构建 Debug 版本、启动可用的 iPhone 模拟器、安装并打开应用，无需先配置开发者签名。通过 `-local-preview` 启动的 Debug 模拟器版本使用独立 JSON 测试目录，不读取正式数据。Release 和真机不接受此模式。

支持旧版 Simulator.app 和 Xcode 27 的 Device Hub；Xcode 27 中在 Device Hub 选择已启动的 iPhone 即可操作。

可以依次测试：从桌面端通过 iCloud 同步模型配置 → AI 添加卡片 → 翻面并评分 → 卡片页搜索、编辑和朗读 → 重启后确认数据保留。iOS 仅展示模型配置，模型修改与卡片 JSON 导入导出均在桌面端完成。文件同步使用固定 iCloud 目录，首次使用通过系统文件选择器授权。

### 真机与 iCloud Drive

1. 打开 `ios/VibeWord.xcodeproj`，选择 `VibeWord` scheme，配置自己的 Team 和可用的 Bundle ID。
2. iPhone 开启开发者模式后连接 Mac 安装。手机主 App 不再申请 CloudKit、iCloud 容器或推送权限；Personal Team 可用于手机开发测试。Watch 目标的 App Groups 签名要求独立处理。
3. 在设置中启用 iCloud 并统一保存。目录固定为 `iCloud Drive/VibeWordSync-v1`；iPhone 首次启用需授权该目录，Mac 自动使用该目录。
4. 在桌面端配置文字及画图模型，通过 iCloud 同步到手机后，即可在添加页使用 AI 制卡。手机不支持手动新增、JSON 导入导出或修改模型配置。
5. 设置页修改后在底部显示统一保存按钮，关闭前可保存、放弃或继续编辑；有草稿时禁用滑动关闭。退到后台或被系统结束时保留本机草稿，下次打开恢复设置面板；iOS 不允许应用拦截退出。

详见 [JSON 格式与同步说明](../docs/FILE-SYNC.md)。新版数据保存在开放 JSON 事件文件，旧 Core Data/SQLite 仅作一次性只读迁移；文字与画图模型配置（含 API Key）一起同步，API Key 以明文保存在事件文件中。

增加或删除 Swift 文件后运行 `python3 ios/scripts/generate-project.py`。脚本保留已有 Team、Bundle ID 等签名设置。

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
- 同文件夹两台设备互传卡片、图片、学习进度；离线评分与删除；杀进程重启、iCloud 文件下载、配额满、目录移动和授权恢复。模型 API 配置（含 API Key）一起同步，切换同步目录会合并而非隔离数据。
- Markdown 使用原生文本编辑加预览，当前支持常用标题、强调、链接、图片、引用、无序列表；不是桌面 Milkdown 的所见即所得编辑器，复杂嵌套 Markdown 的视觉呈现尚不完全相同。
- iOS 后台执行受系统限制，生成任务仅在进程存活期间保留，不能保证锁屏后一直执行；失败可重试。原桌面队列同样不跨重启持久化。
- 保留 HTTP 兼容 API 能力（如局域网 Ollama），Info.plist 因此允许任意网络请求；生产分发需按照实际支持的服务评估 ATS 设置。

这些限制与未验证项在完成前，不能把本次交付视为“功能完全一致”的最终验收。
