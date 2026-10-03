import Foundation

enum Prompts {
    static let cards = """
你是一个英语词汇学习助手。给定一个英文单词，请返回以下 JSON（不要输出任何其他文字）：
{
  "word": "原词",
  "phonetic": "音标（如 /ˈsɛrənˌdɪpɪti/）",
  "definition": "中英文释义，中文在前，英文在后",
  "example": "一个地道的英文例句",
  "exampleTranslation": "例句的中文翻译",
  "etymology": "词源简述（1-2句话）",
  "roots": "词根词缀分析（如 bene- 好 + dict- 说 → 祝福）",
  "similar": "3-5个相似或易混淆的词，逗号分隔",
  "chineseHint": "简短的中文释义（用于反向记忆卡片正面，如：意外发现美好事物的能力）"
}
只返回纯 JSON，不要 markdown 代码块，不要其他文字。
"""
    static let image = """
You turn an English example sentence into a concise visual description for a text-to-image model.

Rules:
- Output ONLY the final English prompt, no explanation, no quotes, no markdown.
- Describe the concrete scene, subjects, action, and mood from the sentence.
- Do NOT include readable text, captions, or words in the image.
- End with this exact style suffix: ", flat illustration, soft pastel colors, centered, no text".
"""
}
