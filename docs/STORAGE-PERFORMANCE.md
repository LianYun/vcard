# 本地存储与同步的后台执行

Mac 和 iOS 使用同一个 JSON 事件存储和 reducer，事件格式、学习算法及 iCloud 目录保持兼容。没有数据库迁移。

## 执行与通信

- `EventWorkers.local`：串行执行打开、迁移、校验、学习选择、评分及兄弟卡片处理、事件写入和卡片库投影。
- `EventWorkers.sync`：串行执行文件提供者访问、云端文件读写、附件交换和备份文件写入。
- `MainActor`：接收不可变 `StoreSnapshot`，更新界面及错误提示；不等待存储锁或文件提供者。

`Persistence.open/perform/commit/review` 通过 continuation 等待队列结果。保存成功后才推进学习界面；失败保留当前卡片和答案。每个快照有递增 revision，界面丢弃旧快照。Mac 的现有 Tauri 命令不变，文件夹选择面板仍在主线程。Rust→Swift 的兼容信号量只在 Rust blocking worker 上等待。

存储首次打开建立事件 ID／内容索引、导出文件缓存及卡片库。普通有序评分、发卡、控制和设置变化使用共享 reducer 增量更新。乱序、撤销、恢复、卡片或牌组结构变化回退到后台完整重放。主线程刷新读取快照，避免反复读历史文件。日期校验仍使用严格 DateFormatter，每个工作线程缓存最多 4096 个校验结果。

## 同步与备份

云端扫描读取新增／变化文件后，单独请求本地队列导入；导出缓存返回不可变数据，云端写入期间没有本地锁。文件名、大小和修改时间相同的已校验文件跳过读取；手动检查重新完整校验本地及云端内容。附件保留原有哈希地址及只复制缺失文件的规则。

保存后 2 秒防抖，连续保存最多 10 秒发起同步。启动、前台恢复、15 秒周期及手动请求合并，只有一轮同步执行。配置变更立即取消旧任务的后续操作，再在同步队列处理授权和开关。已进入系统文件协调的操作无法强制中止，返回后检查取消标记和配置版本，旧任务不能恢复连接或覆盖状态。

自动备份捕获首次修改前的事件快照后在同步队列写入，失败单独展示在设置中，并在后续写入时重试；评分成功不因备份失败变成失败。手动备份也在同步队列写入，恢复作为本地独占操作执行。Apple Watch 的评分在本地提交成功后确认；手表快照由本地队列生成。

## 验证与性能

运行：

```sh
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/vibe-swift-cache swift test --package-path ios --scratch-path /tmp/vibe-swift-tests --disable-sandbox
bash scripts/test-storage-native.sh
bash scripts/test-storage-native.sh --performance-only
bash scripts/test-anki-native.sh
```

原生书签／文件协调测试需要访问 macOS 系统服务。测试使用随机临时目录；性能脚本排空备份队列后删除样本。慢文件提供者测试检查本地仍能写入、取消后的连接状态、冲突与重复同步。

2026-10-08 本机优化编译的合成样本（每文件 10 个事件、单一卡片的固定大小历史，40 次评分）结果：

| 历史事件 | 小文件 | 冷启动读取与投影 | 评分 P95 |
| --- | --- | --- | --- |
| 10,000 | 1,000 | 约 0.47 秒 | 约 1ms |
| 50,000 | 5,000 | 约 2.36 秒 | 约 1ms |

这是 Mac 上的存储层结果，不代表 iPhone 实测，也不覆盖大量正文、附件或高基数卡片库。真机的 200／300ms 评分 P95、2／5 秒启动目标仍需用真实数据验收。运行时 `VibeWord perf` 日志记录超过 25ms 的 load、projection、commit、sync-read 和 sync-write 阶段，只包含阶段、数量和耗时。


## 桌面评分的绘制链路（2026-10-08）

桌面前端此前每次评分后又请求 studyData、cards、decks，传输和解析整库历史；状态轮询也把本机评分当成库变更。现在评分仅返回本次进度、评分 ID 和兄弟卡片的控制变更。当前队列只保留所需进度，评分历史在打开详情时按卡片读取最近 20 条。syncRevision 单独标识云端导入，本机评分不再触发隐藏页面和 Markdown 媒体的全量刷新。

原生写入由本地存储队列串行执行，不再重复获取浏览器跨标签锁；浏览器 localStorage 模式仍保留跨标签锁。收到持久化成功结果后，对小的学习队列更新使用一次 flushSync，直接绘制下一张卡片的正面。没有提前显示未经保存的进度；失败保留当前卡片和答案。按钮在短暂保存期间不再整排变暗或上下跳动。

`scripts/test-review-smooth.cjs` 使用隔离的 2000 张卡片和 5 万条历史，通过模拟原生 RPC 验证前端。观察到点击至新卡片绘制从约 80ms 降到约 9–13ms，React 更新约 2ms，评分请求从 4 次降到 1 次。这是浏览器前端样本，未包含真实 WKWebView 和磁盘延迟，不能代替实机指标。测试同时覆盖慢保存、双击去重、撤销、失败后重试、普通轮询不全量刷新、实际导入仍刷新队列。

```sh
# 需要 Playwright 与 Chrome；可通过环境变量指定已安装的依赖。
STUDY_TEST_URL=http://127.0.0.1:5193 PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE=/path/to/chrome node scripts/test-review-smooth.cjs
```

前端和 Swift 桥接协议需要一同更新。仅热更新前端时，旧原生回复会使用兼容性的刷新路径；应退出旧应用，再使用新构建的 Mac 应用验证。

## 桌面学习启动（2026-10-08）

每次开始学习此前发送 `cards / studyData / settings / meta / decks / issue / studyData` 七次请求。即使前五项使用 Promise.all，原生存储队列仍串行执行；前端还要接收整库卡片和进度，然后再次读取队列进度。

现在 `startStudy` 在一个存储工作任务中使用与 iOS 相同的 `StudySelection`，完成标签／牌组选择和新卡发放，保存成功后只返回本次卡片、进度、控制及 FSRS 配置。发放额度、兄弟卡片去重、学习中的分钟等待和提前学习保持原有规则。返回的进度沿用 FSRS 迁移算法，仅为所选卡片收集所需历史；评分上下文验证测试确认它与常规 `studyData` 回复一致。浏览器与非 Mac 存储仍走原有路径。

优化编译的真实 Swift 桥接基准：2,000 张含长正文的卡片、50,000 条历史、120 张待复习卡片；使用独立临时目录，预先完成冷启动，再分别运行五次旧请求链与新请求。以下为中位数，包含原生回复 JSON 编码，不包含 WKWebView 的 IPC 和绘制，也不包含旧流程的前端选卡。

| 阶段 | 旧流程 | 新流程 |
| --- | ---: | ---: |
| 全库学习状态请求 | 30.08ms | 无 |
| 全库卡片请求 | 20.74ms | 无 |
| 再读队列状态 | 12.90ms | 无 |
| 所选卡片 FSRS 迁移 | 包含在状态请求中 | 3.73ms |
| 原生选卡 | 前端执行 | 0.84ms |
| 队列回复编码 | 分散在七次请求中 | 1.62ms |
| 原生请求合计 | 63.54ms | 6.92ms |
| 回复大小 | 3.83MB | 0.23MB |

最慢的单项是全库 `studyData`，其后是全库卡片编码；两次状态读取共同占旧请求链约三分之二。此样本没有新卡，因此性能表中的保存时间接近零；新卡持久化、重复启动和重开不重复发卡由功能测试覆盖。独立冷启动约 2.29 秒，其中读取 52,000 个事件约 1.70 秒、投影约 0.08 秒，属于首次打开存储的成本。

隔离 Chrome 中模拟原生 RPC 的前端测试确认连续五次启动均只有一次 `startStudy`。两轮测试中首次点击到卡片绘制约 38–40ms，随后约 8–17ms；这与原生基准是两项独立测试，不能相加当作 Mac 应用实测。测试还覆盖慢回复期间保持准备状态、启动失败后重试，以及评分、撤销、双击去重、保存失败重试和云端导入刷新。真实用户库、WKWebView 和 iPhone 耗时仍需在相应应用中测量。

运行：

```sh
bash scripts/test-study-start-native.sh
STUDY_TEST_URL=http://127.0.0.1:5193 PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE=/path/to/chrome node scripts/test-review-smooth.cjs --start-performance
```

运行时 `[study-start] ready` 记录 `snapshotMs / selectionMs / commitMs / migrationMs / encodeMs / nativeMs / requestMs / shuffleAndPublishMs / totalMs`。`requestMs` 与 `nativeMs` 的差值包括准备、排队、桥接编码与传输；`totalMs` 到发布 React 状态为止，实际绘制由浏览器测试单独测量。日志只有数量和耗时。由于新增了原生命令，应用需要同时重新构建前端与 Mac 原生桥接，退出旧进程后再运行；仅 Vite 热更新不足以使用这条新路径。
