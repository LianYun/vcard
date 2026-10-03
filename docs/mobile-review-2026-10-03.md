# iOS / Android 整体复查（2026-10-03）

## 结论

已复查 SwiftUI/Core Data iOS 客户端、Android WebView/Java 桥、共用 React 业务代码及构建脚本。核心学习流程、四档 SM-2、每日额度、双向 AI 制卡、可选配图、搜索/编辑/删除、导出格式、统计和设置均存在对应实现；当前仍不能宣称所有功能完全一致或完成生产验收。

## 本次修复

- 生成队列按任务保存 API 配置快照，避免排队任务拿到其他任务的供应商/模型；取消后的请求在真正结束前仍占并发槽，保存前再次检查取消，避免已取消的生成结果落库。
- Android 桥正确处理 HTTP 204/205/304 的空响应，非法状态码立即失败，避免 Promise 永久悬挂。
- AI 返回 JSON 必须包含所有字符串字段，与 iOS 解码规则一致；错误提示不再回显供应商响应中的潜在凭据。
- localStorage 写入失败不再伪装为成功；删除入口清理关联进度，避免依赖某一个 UI 调用者。
- 日期分组改用本地日期键，消除按 86400 秒回退在夏令时切换时与 iOS 的差异。
- iOS 所有朗读按钮共享一个语音引擎，后一次朗读替换前一次；连续学习天数限制在与 React 相同的 26 周数据窗口。
- Android 重建时清理旧 class/dex/generated 目录，避免删除 Java 类后仍打入旧产物。

## 本次验证

- `npm run test:mobile`：真实 TS 模块的队列配置、取消、并发、保存边界、删除清理、存储容量错误、Android 空响应/非法响应、AI 字段校验通过。测试依赖用可控替身，不连接真实模型。
- `node ios/scripts/generate-fixtures.mjs`：从真实 TS 生成 192 组 SM-2 和 Obsidian 导出样本，并核对两个平台完整提示词。
- `npm run build`、`npm run android:build`：TypeScript/Vite/Java/APK 签名检查通过；Vite 有大于 500 kB 的包体提示。
- `swift test --package-path ios` 与 CLT 适配脚本：10 项测试通过，新增 mock API 验证双向卡片、配图失败保留文字、字段缺失拒绝；最终 iOS Simulator 构建通过。
- iOS XCUITest：iPhone 18 Pro / iOS 27，1 个完整流程通过（添加、Markdown、例句、翻面、重来/良好、完成计数、冷启动保留、编辑、删除后冷启动、设置）。测试使用 UUID 独立数据库。
- Android 16 模拟器使用 `/tmp/vibe-review-userdata.img` 独立临时数据盘：手动卡片、Markdown 编辑、例句、初始进度、翻面评分/次日排程、412px 无横向溢出通过。
- Android 强制停止后重新启动：卡片和进度与停止前快照完全一致。
- Android mock API：原生 HTTP、双向制卡、配图提示词改写、生图、图片显示和 HTML 事件属性清理通过。测试凭据无真实权限。

## 仍存在的差异与验收边界

| 项目 | iOS | Android | 判定 |
| --- | --- | --- | --- |
| Markdown 编辑与渲染 | 原生源码编辑、有限块语法预览 | Milkdown 编辑、marked GFM 渲染 | 不完全一致：复杂嵌套、表格、代码块等尚未统一 |
| 云同步 | Core Data + CloudKit 私有库 | 仅 WebView 本地存储 | 不一致；Android/桌面未接入 iCloud，也没有跨端导入 |
| AI 双卡写入 | 单次本地事务 | 多次 localStorage 写入 | 容量不足/进程中断时 Android 可能部分保存；本次只修复错误被吞掉，不宣称原子一致 |
| 配图持久化 | 下载图像字节，最多 15 MiB | 保存模型 URL 或 base64 | URL 过期后的持久可用性不一致；HTTP 图片兼容性也不同 |
| 同步冲突 | 删除永久优先、事件合并 | 无同步 | iCloud 双真机、账户切换、配额异常、Production schema 未验收 |
| 运行/发布 | 模拟器本地预览通过 | Debug APK 通过 | 未进行真实付费 API、设备语音、无障碍、所有尺寸、生产签名/商店发布验收 |

iOS 的原生 UI 与 Android 的 React UI 不要求像素相同；但上表中的能力差异是真实存在的，不能将测试通过解释为全功能等价。补齐跨端云同步或更换 iOS Markdown 编辑器属于后续功能开发，未在本次 review 中擅自替换技术方案。

## 提交范围

提交两端源码、工程资源、构建/运行脚本、测试、共用适配修复和本报告。现有项目介绍文档/幻灯片、public 演示、`.tmp`、编译缓存和本地签名不纳入移动端提交。历史已经跟踪的 dist/index.html 和 tsbuildinfo 保留在工作区，不将其单独发布为完整构建产物。
