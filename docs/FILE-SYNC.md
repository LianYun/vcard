# 开放 JSON 存储、导入与 iCloud Drive 同步

Mac 和 iPhone 使用同一套 JSON 事件存储，不再向 SQLite/Core Data 写入应用数据。浏览器及 Android 保持原有 localStorage；其他桌面平台的旧存储未在本次改动中迁移。

## 使用方法

1. 两端固定使用 `iCloud Drive/VibeWordSync-v1/events/`，不再允许更换同步目录。在设置中勾选“将数据同步到 iCloud”，右上角“保存配置”后生效。
2. Mac 自动访问系统 iCloud Drive 根目录；iCloud Drive 不可用时保存会提示错误。iPhone 首次启用或授权失效时仍需通过系统文件选择器授权 **iCloud Drive 根目录下的 `VibeWordSync-v1`**，不存在时先创建同名文件夹；其他目录会被拒绝。这是固定目录授权，不是可配置路径。
3. App 在启动、iPhone 回到前台、写入后以及运行期间每 15 秒合并文件，也可以点击“立即同步”。关闭开关仅停止同步，不删除本地或云端文件。
4. 桌面端 JSON 导入位于“添加”页，JSON 导出位于“卡片”页。iOS 不提供 JSON 导入导出，添加页仅支持 AI 添加。设置页不放置导入、导出或更换目录入口。
5. 桌面端的语言、学习上限、文本/图片模型、iCloud 开关统一保存。iOS 的模型配置仅展示（API Key 隐藏），需在桌面端修改后同步；手机保存设置不会写入模型配置，旧草稿中的模型修改也不会生效。切换页面前如有未保存内容，会提供保存、放弃、继续编辑。Mac 关闭窗口和退出应用也会确认。
6. iOS 无法阻止系统回到主屏幕或强制终止应用：未保存草稿只保留在本机，不生效、不同步；重新进入应用时询问保存或放弃。浏览器关闭/刷新采用浏览器自身的离开提示。

这里不使用 App 专属 iCloud 容器或 CloudKit entitlement。iPhone 通过系统文件选择器获得固定目录的访问权限，仍可使用 Personal Team 测试。Mac 不再依赖旧的目录授权书签；旧书签和旧目录文件保留，但不会作为新的可选路径。原来使用其他目录的设备需先同步旧版本中的待合并数据，再统一使用固定目录。

iCloud Drive 决定文件上传与下载时间；“已写入同步目录”不代表另一台设备已经收到。iPhone 退出/被系统挂起后不保证继续合并，重新打开会重试。固定目录路径与授权恢复仍需真实双设备 iCloud 验收。

## 让其他软件生成卡片

生成 UTF-8 的 `cards.json`，然后在桌面端的“添加”页选择卡片导入。示例：

```json
{
  "format": "vibe-word.cards",
  "version": 1,
  "cards": [
    {
      "id": "my-source:apple",
      "front": "apple",
      "back": "苹果\n\n**词性**：名词",
      "example": "I ate an apple."
    }
  ]
}
```

可直接使用 [完整示例](formats/cards.example.json) 和 [JSON Schema](formats/cards.schema.json)。

- `id`、`front`、`back` 必填；`example`、`createdAt` 可选。正面不能全为空白。`createdAt` 为 Unix 秒数，不是毫秒；省略则首次导入时赋值。
- ID 应由来源稳定生成，例如 `anki:12345`、`my-course:lesson-01-word-03`，不同来源使用不同前缀。ID 不超过 512 个 UTF-8 字节；一份文件内不能重复。
- 同 ID、内容相同：跳过；同 ID、内容不同：更新卡面、保留创建时间和学习进度。未包含的旧卡片不会被删除。
- 导入过的卡片若已删除，旧 ID 不允许复活；确需恢复请换一个新 ID。导入不是删除接口。
- 正反面支持现有 Markdown。图片可使用 Markdown 图片 URL 或内嵌 data URL；相对附件路径不会自动复制。单文件/单次事务上限 32 MB，超出请拆分。
- 格式/版本/字段校验失败则整份卡片文件不落盘。Schema 提供结构校验；App 额外检查 ID 唯一、UTF-8 字节数、正面非空等规则。
- “导出卡片 JSON”生成同一种格式，含当前未删除的卡片，不含 API Key、模型配置或学习历史。完整学习历史保存在事件文件中。
- 不要把 `cards.json` 手工放进 `events/`：那里是同步协议目录。通过导入按钮转成事件后，修改才会传播到其他设备。

## 本地存储与同步协议

Mac 本地路径为 `~/.vword/library/events/*.json`；iPhone 在应用 Documents 下的 `VibeWord/events/`。调试模拟器的 `-local-preview` 使用独立 `VibeWordPreview`，UI 测试另用 UUID 目录。

每次事务是一个独立 UTF-8 JSON 文件，通过临时文件 + 原子替换保存。文件名为内容 SHA-256，事件 ID 去重。格式为：

```json
{
  "format": "vibe-word.events",
  "version": 1,
  "events": [
    {
      "id": "A-UNIQUE-EVENT-ID",
      "timestamp": 1791028800,
      "kind": "delete",
      "day": "2026-10-03",
      "cardId": "my-source:apple"
    }
  ]
}
```

完整字段以共享的 `SyncEvent.swift` 为准。常见 kind 为 add/edit/delete/review/seed/issued/studyConfig；API 配置事件 llmConfig/imageConfig 同步完整的 API 地址、API Key 和模型名。迁移完成标记不传播。配置按时间和事件 ID 合并，最后一条生效；清空画图配置也会同步。已有本地配置会在下次同步时自动上传，无需重新保存。

卡面、评分、统计按时间和事件 ID 确定性合并；删除墓碑优先，离线旧编辑不会复活卡片。同 ID 事件若内容不同则报错，不静默覆盖。不要手动编辑已生成事件或删除事件历史；通过卡片导入接口修改内容。不同设备同时离线评分时次数都会计入，最终排程采用最后一条进度。

API Key 在本地和同步事件文件中均以明文保存，历史配置也会保留在事件日志中。App 向固定目录 `iCloud Drive/VibeWordSync-v1` 写入卡片、学习数据和模型配置，请使用自己的同步文件夹。Mac 和 iPhone 都需升级到支持模型配置同步的版本，旧版本会拒绝包含模型配置的同步文件。卡片自身若包含敏感文字/带凭据的 URL，属于卡片内容，会随卡片同步。

## 旧数据迁移

- Mac 首次使用 JSON 存储时只读导入 `~/.vword/CloudLibrary.sqlite`（若存在），再按旧迁移标记决定是否导入 `~/.vword/vword.db`。进度、配置、历史统计均保留。
- iOS 只读导入原 Core Data 默认目录下的 `VibeWord.sqlite`。原库的外置 payload 和 WAL 文件必须保持完整。模拟器本地预览不读取正式数据库。
- 迁移按有界批次原子写入，全部成功后写完成标记，失败可重试，已有事件去重。不会删除、覆盖旧数据库；新版不会持续与旧程序共享数据库。
- 使用新版前关闭旧版。保留原始数据备份，避免轮流运行旧版和新版造成修改分叉。

## 验证边界

自动化覆盖 JSON 读写/重启、旧 SQLite 迁移、重复导入、编辑保留进度、非法文件原子拒绝、冲突/删除、双目录文件协调、书签恢复、双向模型配置同步和配置清空。真实 iCloud Drive 上传下载、跨 Mac/iPhone 的权限恢复与系统后台调度仍需两端选择文件夹后验收；本地文件交换测试不能替代云端实测。

## 2026-10-04 设置交互验证

- `npm run build`、`node scripts/test-localization.mjs`、`cargo check --manifest-path src-tauri/Cargo.toml --offline` 通过。
- `bash src-tauri/macos/test.sh --storage-only` 通过：统一设置批次、非法上限拒绝、固定目录、旧书签隔离、开关保存与重启、关闭后数据保留、iCloud 不可用、iOS 目录校验，以及既有迁移/文件交换回归。
- iPhone 18 Pro / iOS 27 模拟器：`testUnifiedSettingsAndDraftRecovery` 与 `testInterfaceLanguageSwitchAndPersistence`，2 项通过、0 失败。覆盖 JSON 入口位置、统一保存、语言延迟生效、继续编辑、放弃、保存后切页、强制结束后草稿恢复、后台返回确认。
- localhost 浏览器实际点击通过：放弃后恢复原值、继续编辑保留草稿、保存并离开后读回新值、语言与学习设置一次保存、无效上限保存失败时继续停留。
- Mac 原生关闭窗口 / Cmd-Q 拦截已编译，尚未实际点击验收；真实 iCloud 授权和双设备传输也未验收。
- 未把完整套件标记为通过：`npm run test:mobile` 在现有测试桩加载 `llm.ts` 时因未提供 `./storage` 依赖失败；原生完整测试在 `DocumentImportTests.swift` 的 DOCX 内嵌图片像素断言失败。未修改这两处文档导入逻辑，相关存储回归使用明确的 `--storage-only` 范围单独验证。

iOS 退出处理依据 Apple 的[生命周期说明](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/applicationwillterminate(_:))：挂起中的应用被终止时无法依赖终止回调。固定目录授权沿用[系统目录访问机制](https://developer.apple.com/documentation/uikit/providing-access-to-directories)。

## 2026-10-04 复习增强协议

新写入的事件文件版本为 2，仍能读取历史版本 1。新增完整评分记录、卡片状态、撤销及恢复事件，并支持分钟级重学。同步目录名称保持 `VibeWordSync-v1`，目录名不代表事件格式版本。参与同步的 Mac/iPhone 应一起升级；Watch 传输协议同步升级至 2。本机备份不作为普通同步文件上传，用户确认的恢复操作则以恢复事件同步。

卡片导入格式仍为版本 1，新增可选 `noteId` 表示同一词条的关联卡；旧卡不自动配对。功能、恢复语义和验证范围见 [复习增强说明](STUDY.md)。
