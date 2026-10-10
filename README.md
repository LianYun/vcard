# Vibe Word

一个用 React + TypeScript 实现的轻量级背单词应用，采用 SuperMemo-2 间隔重复算法。浏览器使用 localStorage；Mac 和 iPhone 使用开放 JSON 文件，并可通过用户选择的 iCloud Drive 文件夹同步。无需自建后端。

开放导入格式与用法见 [JSON 导入和文件同步](docs/FILE-SYNC.md)，可直接下载 [卡片示例](docs/formats/cards.example.json)。

## 功能

- **间隔重复复习**：基于 SuperMemo-2 算法，自动安排每张卡片的下次复习时间。
- **AI 任务队列**：后台生成，逐张阅读／编辑后确认入库，重新生成确认后才替换；详见 [任务队列](docs/AI-TASK-QUEUE.md)。
- **自建卡片**：随时添加自己的单词卡（正面/背面/例句），可编辑、删除。
- **每日新词预算**：在设置中控制每天自动引入多少张新卡。
- **纯本地存储**：自建卡片与学习进度都存在本地，刷新或关闭后仍在。

## 技术栈

- Vite + React 18 + TypeScript
- Tailwind CSS
- localStorage 持久化（无后端）
- SuperMemo-2 调度算法

## 开发

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（默认 http://localhost:5173）
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产构建
npm run typecheck # 仅类型检查（不构建）
npm run tauri:dev   # 桌面应用开发模式
npm run tauri:build # 本地打包（生成 .dmg / .msi）
```

## 发布版本

发布通过 GitHub Actions 自动完成：

1. 在 `package.json` 和 `src-tauri/tauri.conf.json` 中更新版本号
2. 提交并推送
3. 打 tag 并推送：
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. GitHub Actions 会在 macOS (Apple Silicon) 和 Windows 上构建，并将产物作为草稿发布到 [Releases](../../releases)
5. 进入 Releases 页面，编辑并发布草稿即可

CI 工作流：每次 PR / push main 自动跑前端 typecheck + build 与 Rust `cargo check`。

## 算法说明

每张卡片维护三个参数：`ease`（难度系数，默认 2.5，下限 1.3）、`interval`（下次复习间隔，天）、`repetitions`（连续答对次数）。复习时根据回忆质量（Again=1 / Hard=3 / Good=4 / Easy=5）更新：

- 质量 < 3（Again）：重置 repetitions，间隔回到 1 天。
- 质量 ≥ 3：repetitions +1；第 1 次→1 天，第 2 次→6 天，之后 = round(上次间隔 × ease)。
- ease 按公式 `EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02))` 更新。

实现见 `src/lib/sm2.ts`（纯函数）和 `src/lib/scheduler.ts`（今日队列）。

# Install

如果安装后无法打开，请使用下面的命令
```bash
sudo xattr -r -d com.apple.quarantine <程序地址>
```
