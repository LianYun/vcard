# Anki 牌组导入

## 使用

在 Mac 应用「添加 → 导入 Anki」选择从 AnkiWeb 下载的 `.apkg`。预览包含子牌组、实际卡片数、媒体和兼容性报告。勾选父牌组会包含全部子牌组；可指定现有父牌组。模板无法转换时可按笔记类型指定正反面字段，再生成预览。

导入每批 100 张。可在批次边界暂停；重新打开入口可找到尚未完成的导入。进程中断后重新从头确认也安全：已保存、已修改、已删除的来源卡片均跳过，不复活卡片、不重置学习进度。卡片内容直接导入，不调用大模型。

「我的卡片 → 牌组」支持创建、改名、调整父级、每日新卡上限、选卡批量移动、按父/子牌组学习。删除牌组保留卡片并移入默认牌组，子牌组提升一级。旧卡片按默认牌组读取，不修改其 ID 或进度。

## 兼容范围

- `collection.anki2` / `collection.anki21` 的 schema 11，以及 `collection.anki21b` 的 schema 18；新版 ZIP 内的 Zstandard 数据与 protobuf 配置/媒体清单。
- 包内实际存在的普通、反向和 Cloze 卡片，常规字段替换、条件段、FrontSide、text/cloze 过滤器。
- 同编号多空、提示、嵌套及多编号 Cloze。保留字段和模板原文，通过「编辑 Anki 笔记」同时更新兄弟卡；新增/删除编号增删对应卡片，其他进度保留。
- PNG/JPEG/GIF/WebP 图片；MP3/WAV/OGG/M4A/AAC/FLAC/Opus 音频文件保留。播放能力取决于系统解码器，失败显示状态。音频点击播放，可重播，翻页停止。
- 保留源标签、牌组层级、笔记关联。原学习历史不导入，首次学习仍受每日预算约束。

模板脚本不执行，自定义 CSS 保留在来源记录中但不应用；使用统一排版。Image Occlusion、其他模板过滤器、SVG、视频等不在当前支持范围，报告跳过或附件缺失。字段映射是用户明确选择的简化显示，不承诺所有共享牌组原样还原。没有 AnkiWeb 账号同步、FSRS 导入、动态筛选牌组引擎或完整 Anki 模板编辑器。

导入入口目前在 Mac。iOS 可通过现有文件夹同步接收牌组和媒体、按牌组学习、编辑笔记并播放附件；浏览器支持牌组管理与学习，不支持直接解析 `.apkg`。Apple Watch 保持现有学习功能，本次不提供手表音频/图片渲染。

## 存储与额度

- `Card.deckId` 指向稳定 Deck ID。Deck 事件保存名称、父级与可选每日上限。
- Anki 来源笔记以 `Card.anki` 快照保留，通过 `noteId` 聚合。共享 Swift 渲染器负责导入及 Mac/iOS 的笔记修改，原手工卡的 front/back 路径保留。
- 卡片 ID 来源于笔记 GUID、模型 ID、模板/填空序号；不依赖包文件名。来源牌组按源 ID 标识，同一来源再次导入沿用本地牌组设置。
- 发放事件保存当时的祖先牌组 ID，每日消耗同时计入祖先及全局；移动卡片不会返还额度。多台设备离线并行学习的总额度仍可能超出，这是当前离线事件同步模型的限制。
- 媒体为 `library/media/<sha256>.<extension>`，卡片引用 `vibe-media:`。不同文件同名不会覆盖；相同内容去重。只访问受控目录和校验过的文件名。
- 同步附件与事件分别传输。附件未下载时提示，同步更新后重试显示。文件按哈希校验；没有自动附件清理，避免删掉其他卡片、备份仍需的文件。
- 备份为 JSON + 同名 `.json.media/` 附件目录，二者需一起保留。旧 JSON 备份仍可读取。卡片 CSV/JSON 导出不是包含媒体的完整备份。
- 事件格式升级至 v3，读取 v1–v3。同步设备需更新到支持 v3 的客户端；旧客户端不能读取新事件。

## 验证

```sh
npm run build
bash scripts/test-anki.sh
ANKI_TEST_SYNC=1 bash scripts/test-anki.sh
node scripts/test-study.mjs
node scripts/test-tags.mjs
node scripts/test-mobile.mjs
node scripts/test-localization.mjs
bash src-tauri/macos/test.sh
```

`test-anki.sh` 使用仓库内由官方 Anki 26.9.3 生成的新旧 APKG，先验证 Rust 解包，再验证 Swift 转换、原生保存、幂等、Cloze 编辑、附件备份，以及浏览器牌组预算存储。同步测试需要 macOS 安全书签服务。

`/design/anki-import-check.html` 是 Vite 开发专用的 UI 测试页：使用同一样本的原生解析结果，模拟 bridge 响应以检查预览、图片及音频播放；它不连接个人牌库，保存按钮模拟成功。真实保存由原生测试覆盖。测试 APKG、生成脚本和预览数据在 `scripts/fixtures/anki/`。

已验证网页构建、Rust/Swift 测试、iOS 模拟器目标编译、浏览器图片解码和 WAV 播放。真实 iCloud 跨设备传输与各系统全部音频编码的兼容性尚需真机验收。
