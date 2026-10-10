# Apple Watch 版本

SwiftUI，watchOS 10+；依赖配对 iPhone 提供卡片，已缓存的卡片支持离线复习。
工程使用单 target Watch App，另外包含 WidgetKit 表盘组件和 watchOS UI 测试 target。

## 使用

打开 `ios/VibeWord.xcodeproj`，选择 `VibeWordWatch` scheme 和手表目标。
只体验界面可运行：

```sh
bash ios/scripts/run-watch-simulator.sh --demo
```

`--demo` 仅在 Debug 模拟器生效，使用单独的 `watch-demo.json`，内置 5 张示例卡片，
不连接手机、不写表盘共享存储。正式安装没有内置假数据。
不带参数启动正常模式，首次打开会提示在配对 iPhone 上打开 Vibe Word。
可通过 `WATCH_DEVICE_ID` 和 `WATCH_BUILD_DIR` 指定模拟器和构建目录。

首版流程：每轮最多 5 张 → 回忆 → 查看答案 → 重来/困难/良好/简单。
长卡片可滚动并打开完整释义；无可靠结构字段时展示原文字，不推测单词释义。
“稍后继续”保留本轮；熄屏、退出、重启后仍保留队列、翻面状态及待回传记录。
缓存用完只显示“本机卡片已学完”，不代表其他设备的全部词库已完成。

## 配对手机和签名

三个应用 targets 使用同一开发者 Team，并配置匹配的 Bundle IDs：

- `VibeWord`：`com.lianyun.vibeword`
- `VibeWordWatch`：`com.lianyun.vibeword.watchkitapp`
- `VibeWordWatchWidgets`：`com.lianyun.vibeword.watchkitapp.widgets`

修改 Bundle ID 时也修改 Watch target 的 `COMPANION_BUNDLE_IDENTIFIER`。
Watch App 和 Watch Widgets 都要启用相同的 App Group；默认构建变量
`WATCH_APP_GROUP=group.com.lianyun.vibeword.watch`，需要在开发者账户实际注册并匹配签名。
App Group 只共享**手表本机**的摘要，不用于手机和手表之间传输。
修改工程结构后执行 `python3 ios/scripts/generate-project.py`；脚本会重建工程，
之后需重新检查自定义 Team、标识和签名设置。

手机卡片发生变化会排队更新学习包，设置 → Apple Watch 也可以手动请求更新。
手表同步页显示缓存数量、待回传条数及快照生成时间；系统安排实际后台传输时机。

## 数据与同步

- `VibeWord/Core/WatchStudy.swift`：跨平台可测试的学习会话和协议；直接复用 `SM2`、`Day`。
- `Shared/WatchLink.swift`：WatchConnectivity 传输。评分/请求走后台 user info，
  可达时同时用消息加速；快照走文件，小快照可用消息加速。重复传输是正常情况。
- `VibeWord/App/PhoneWatchSync.swift`：手机持久化评分、生成学习快照。
- `WatchApp/WatchStore.swift`：原子写入手表文档，包含 baseline、待回传评分、当前会话。
- `Shared/WatchSummary.swift`、`WatchWidgets/WatchWidgets.swift`：表盘摘要与午夜 timeline。

学习包最多 500 张已引入的卡片，优先最早到期项。单卡超过 100 KB 或卡片文字累计
超过 4 MB 的部分留在手机，同步页明确显示未缓存数量。手表不领取没有 progress 的新卡。
现有“新建卡片立即初始化进度”的规则保持不变。图片及 Markdown 图片地址从手表文字
投影中移除，不传 API Key、AI 配置和原始事件日志。

每次评分先把会话和待回传记录一并原子落盘，再推进 UI。手机只导入未保存的 UUID，
成功保存后在快照里确认；手表同时应用新 baseline 和确认列表。仅传输成功不清空记录。
旧 revision 不回滚数据；新快照之上的未确认评分继续参与排程投影。
同一卡片冲突采用现有事件时间戳/UUID 规则，活动次数累加，排程以最后事件为准；
不把两个独立 SM-2 状态相加。删除优先，未回传旧评分仍保留为历史活动，不复活卡片。

设备 ID 防止手表重装后接收旧学习包。更换手机来源且有未确认评分时拒绝替换，
需连接原手机完成同步。本机文档损坏时显示错误并保留原文件，不自动清空。

Widget 显示已缓存卡片的待复习数，支持圆形、矩形、行内入口；点击打开
`vibeword://study`。刷新受系统预算约束，进入 App 以当前本地数据为准。
手表后台 WatchConnectivity 任务等待系统投递完成再结束。

## 验证命令

```sh
swift test --package-path ios
xcodebuild -project ios/VibeWord.xcodeproj -scheme VibeWordWatch \
  -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/VibeWord.xcodeproj -scheme VibeWord \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/VibeWord.xcodeproj -scheme VibeWordWatch \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 12 (42mm)' \
  CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO test
```

核心测试覆盖：每轮 5 张、重来、重启数据编解码、旧快照、重复确认、删除、
并发手机评分、来源改变、跨天、无凭据投影及非法数据。
UI 测试通过 `VIBE_WATCH_TEST_STORE` UUID 使用独立的模拟器示例库，验证实际点击评分、
重启恢复和待同步记录，并保存页面截图。

2026-10-03 本机验证（Xcode 27）：

- 20 项 Swift 核心测试通过，包含 192 组原有 TypeScript SM-2 对照样本及 10 项 Watch 测试。
- iPhone Simulator 与 Watch Simulator（含 Widget）构建通过。
- watchOS Release 真机目标无签名构建通过；这只验证编译和打包，不代表已安装到真机。
- 42mm Series 模拟器与 40mm SE 模拟器 UI 流程通过：开始、翻面、重来、重启继续、
  完成 5 张、6 条活动记录在第二次冷启动后仍保留。
- 最终小屏布局使用底部固定四档评分；测试额外确认“良好”按钮无需滚动即可点击。
- 核心日志：`/tmp/vibe-watch-core-tests.log`；最终小屏 UI 结果：
  `/tmp/vibe-watch-ui-release-review.xcresult`。这些临时证据可能被系统清理，可用上方命令复现。

仍需真机验收：配对传输、手机被系统唤醒、长时间离线/后台、杀进程恢复、
真实 App Group 签名与表盘入口、时区变化和 VoiceOver/最大动态字体。
模拟器与本地测试不能替代这些验收。此任务不配置开发者账户，不发布到 TestFlight。
当前 iPhone 的 CloudKit、桌面桥接设置以各自实现与签名配置为准；Watch 通过配对手机通信。

Apple 参考：[WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity)、
[watchOS 后台任务](https://developer.apple.com/documentation/watchkit/using-background-tasks)。
