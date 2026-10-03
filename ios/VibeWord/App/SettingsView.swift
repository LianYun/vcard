import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var persistence: Persistence
    @State private var limit = 10
    @State private var llm = APIConfig()
    @State private var image = APIConfig()
    @State private var feedback = ""
    var body: some View {
        Form {
            Section("学习设置") {
                Stepper("每天新词上限：\(limit)", value: $limit, in: 0...100)
                Text("控制每天自动引入多少张新词卡。已初始化进度的卡片不受此限制。").font(.caption).foregroundStyle(.secondary)
                Button("保存设置") { if store.save([SyncEvent(kind: .studyConfig, limit: limit)]) { feedback = "学习设置已保存" } }
            }
            Section("AI 模型配置") {
                configFields($llm)
                Button("保存模型配置") { if store.save([SyncEvent(kind: .llmConfig, config: llm.trimmed())]) { feedback = "AI 配置已保存" } }
            }
            Section("画图模型配置（可选）") {
                configFields($image)
                Text("兼容 /images/generations。全部留空可关闭配图；配图失败仍保存文字卡片。").font(.caption).foregroundStyle(.secondary)
                Button("保存画图配置") { if store.save([SyncEvent(kind: .imageConfig, config: image.trimmed())]) { feedback = "画图配置已保存" } }
            }
            Section("iCloud") {
                Label(persistence.syncStatus, systemImage: "icloud")
                Text(Persistence.isLocalPreview
                     ? "当前使用独立的模拟器测试库，可以测试界面、制卡和学习流程。此模式不测试 iCloud 同步。"
                     : "卡片、学习进度、学习记录和配置（包括 API Key）通过当前 Apple 账户的 iCloud 私有数据库同步。离线修改会在联网后自动同步，具体时间由系统调度。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("检查 iCloud 状态") { Task { await persistence.checkAccount() } }
            }
            if !feedback.isEmpty { Section { Text(feedback).foregroundStyle(.green) } }
        }.navigationTitle("设置")
            .modifier(KeyboardDoneModifier())
            .onAppear { limit = store.library.newCardsPerDay; llm = store.library.llm; image = store.library.image }
    }
    private func configFields(_ config: Binding<APIConfig>) -> some View {
        Group {
            TextField("API 地址，例如 https://api.openai.com/v1", text: config.baseURL).keyboardType(.URL)
            SecureField("API Key", text: config.apiKey)
            TextField("模型名称", text: config.model)
        }.textInputAutocapitalization(.never).autocorrectionDisabled()
    }
}
