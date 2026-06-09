// LLM integration: call an OpenAI-compatible API to generate two flashcards
// from a single English word.
//
// Card 1 (en→cn): front = word, back = rich content (definition, example,
//   etymology, roots, similar words).
// Card 2 (cn→en): front = chinese meaning + hint, back = english word.
//
// The function does NOT persist anything — the caller decides whether to save.

import type { Card, LLMConfig } from '../types'

const SYSTEM_PROMPT = `你是一个英语词汇学习助手。给定一个英文单词，请返回以下 JSON（不要输出任何其他文字）：
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
只返回纯 JSON，不要 markdown 代码块，不要其他文字。`

interface LLMResponse {
  word: string
  phonetic: string
  definition: string
  example: string
  exampleTranslation: string
  etymology: string
  roots: string
  similar: string
  chineseHint: string
}

export interface GeneratedCards {
  enToCn: Card
  cnToEn: Card
}

function buildEnToCnBack(r: LLMResponse): string {
  const lines: string[] = []
  lines.push(`*${r.phonetic}*`)
  lines.push('')
  lines.push(r.definition)
  lines.push('')
  lines.push(`> ${r.example}`)
  lines.push(`> *${r.exampleTranslation}*`)
  lines.push('')
  lines.push(`**词源** ${r.etymology}`)
  lines.push('')
  lines.push(`**词根** ${r.roots}`)
  lines.push('')
  lines.push(`**相似** ${r.similar}`)
  return lines.join('\n')
}

function makeId(): string {
  return `custom:${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const braced = text.match(/\{[\s\S]*\}/)
  if (braced) return braced[0]
  return text.trim()
}

export async function generateCards(
  word: string,
  config: LLMConfig,
): Promise<GeneratedCards> {
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: word.trim() },
      ],
      temperature: 0.3,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API 请求失败 (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const content: string = json.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new Error('模型返回了空内容')
  }

  let parsed: LLMResponse
  try {
    parsed = JSON.parse(extractJSON(content))
  } catch {
    throw new Error(`无法解析模型返回的 JSON：${content.slice(0, 300)}`)
  }

  const enToCn: Card = {
    id: makeId(),
    front: parsed.word || word.trim(),
    back: buildEnToCnBack(parsed),
  }

  const cnToEn: Card = {
    id: makeId(),
    front: `${parsed.chineseHint}\n（提示：${parsed.roots}）`,
    back: parsed.word || word.trim(),
    example: parsed.example,
  }

  return { enToCn, cnToEn }
}
