# Vibe Word Android

Android 应用壳（Java + 系统 WebView）打包仓库现有 React 页面，直接复用同一套 SM-2、调度、AI 提示词、三并发生成队列、Markdown 编辑器、搜索、卡片管理和热力图。不是重新编写的 Compose 原生 UI，也不需要本机 Vite 服务才能运行。

## 构建和安装

需要 Node 依赖、Android Studio 自带 JDK、Android SDK Platform 35 / Build Tools 36.0.0 / ADB。默认 SDK 为 `~/Library/Android/sdk`，可用 `ANDROID_HOME` 覆盖；默认 Java 为 `/Applications/Android Studio.app/Contents/jbr/Contents/Home`，可用 `JAVA_HOME` 覆盖。

```sh
npm run android:build
npm run android:install
# 多个设备时：
ANDROID_SERIAL=emulator-5554 npm run android:install
```

APK：`android/.build/VibeWord-debug.apk`。构建使用官方 AAPT2、javac、D8、zipalign、apksigner，直接生成测试包，不下载 Gradle 或 NDK。前端输出到专用目录，不覆盖桌面 `dist/`。本地调试签名保存在 `.build/debug.keystore`，删除后重建的密钥无法覆盖安装旧签名包，届时需卸载旧包（会清空其数据）。

这是可侧载的 **Debug APK**，不是 Play Store 发布包。生产发布需要关闭 debuggable、使用正式签名，并按商店要求构建分发格式。

## Android 适配

- 页面资源随 APK 离线打包，以固定 HTTPS 本地源加载；卡片、配置和进度通过现有 `storage.ts` 存入 WebView 私有 localStorage。重启保留，卸载/清除应用数据会删除。未启用系统备份。
- 朗读调用 Android TextToSpeech；语音语言可用性取决于系统已安装的语音数据。
- Markdown 导出打开系统文件选择器，可保存到 Downloads 等用户选定的位置。
- AI 请求由原生 HttpURLConnection 执行，兼容自定义 HTTP/HTTPS 服务，避免 WebView CORS 限制；限制请求端点、拒绝自动重定向，并支持取消、连接/读取超时和响应大小限制。
- 页面外链交给外部浏览器，不在带原生桥的 WebView 中加载。Markdown 使用 DOMPurify 清理，页面通过 CSP 禁止第三方脚本及 iframe。
- Android 16 状态栏、导航栏、刘海和输入法安全区域由原生容器处理。
- API Key 当前保存在应用私有数据中，**不是 Android Keystore 加密存储**。本版本没有接入 iCloud 或其他跨设备云同步；不会与现有 iOS/桌面数据库自动共享。
- 生成队列与原桌面实现一样驻留进程内，系统终止进程后不保留进行中的任务；没有承诺后台持续运行。

## 验证（2026-10-01）

已在本机 Android 16 ARM64 模拟器 `VibeWord_API_36` 安装并运行：

- TypeScript 检查、Vite 构建、Java 编译、APK 签名验证。
- 实际 UI 填写单词、Markdown 释义、例句并添加；检查初始进度。
- 翻面、良好评分、学习完成，核对 SM-2 的 repetitions=1 / interval=1 / 次日 due。
- 412 CSS px 页面无横向溢出；状态栏不会覆盖标题。
- 本机 mock API 完成原生 HTTP、双向制卡、图片提示词改写、配图渲染。测试后已清空 mock API 配置。
- 模型返回含 onerror 的 HTML 时，渲染结果不保留事件处理器。
- 系统文件选择器成功导出 892 字节 Markdown，读取文件核对 5 张 Obsidian 卡片。
- 强制停止后冷启动，5 张测试卡片和 3 条已评分进度均保留。

`scripts/smoke-test.mjs` 和 `scripts/network-test.mjs` 用于专用测试模拟器的 WebView 调试验证，会创建明确标记的测试卡；网络测试会修改并清空测试安装的模型配置，**不要在已有真实配置或数据的安装上执行**。需要先将应用进程的 `webview_devtools_remote_<PID>` 转发到本机 9223。

真实模型供应商及真实付费生图未测试，未使用任何用户 API Key。
