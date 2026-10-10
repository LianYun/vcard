# Mac JSON 存储与文件同步

Mac 13+ 的 Tauri 客户端静态链接与 iOS 共用的 JSON 事件存储、导入格式、文件夹同步和合并规则。使用系统文件选择器授权 iCloud Drive 文件夹，不需要 CloudKit 签名能力。旧 SQLite/Core Data 代码仅用于只读迁移。

使用步骤、文件格式、迁移和边界见 [开放格式与文件同步](../../docs/FILE-SYNC.md)。

```sh
npm run tauri:dev
npm run tauri -- build --debug --bundles app --no-sign
bash src-tauri/macos/test.sh
swift test --package-path ios
```

Mac 设置入口位于页面上方：选择同步文件夹、立即同步、断开文件夹、导入卡片 JSON、导出卡片 JSON。普通打包不再携带 CloudKit、推送或容器权限。分发时仍按通常的 macOS 签名要求处理。
