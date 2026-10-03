// LLM integration: call an OpenAI-compatible API to generate two flashcards
// from a single English word.
//
// Card 1 (en→cn): front = word, back = rich content (definition, example,
//   etymology, roots, similar words).
// Card 2 (cn→en): front = chinese meaning + hint, back = english word.
//
// Optional image generation: rewrite the example sentence into a visual prompt
// (via the text LLM), then call an OpenAI-compatible /images/generations
// endpoint. On success the image URL is prepended to card 1's back as markdown.
// Image failures are swallowed — cards are always returned.
//
// The function does NOT persist anything — the caller decides whether to save.

import type { Card, ImageGenConfig, LLMConfig } from '../types'
import { apiFetch } from './android'

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
  /** The English example sentence used for card 1 (used for image prompt rewriting). */
  enExample?: string
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
  signal?: AbortSignal,
): Promise<GeneratedCards> {
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`

  const res = await apiFetch(url, {
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
    signal,
  })

  if (!res.ok) {
    throw new Error(`API 请求失败 (${res.status})`)
  }

  const json = await res.json()
  const content: string = json.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new Error('模型返回了空内容')
  }

  let parsed: LLMResponse
  try {
    parsed = JSON.parse(extractJSON(content))
    const fields: (keyof LLMResponse)[] = ['word', 'phonetic', 'definition', 'example', 'exampleTranslation', 'etymology', 'roots', 'similar', 'chineseHint']
    if (!parsed || fields.some(key => typeof parsed[key] !== 'string')) throw new Error('Invalid card fields')
  } catch {
    throw new Error('无法解析模型返回的 JSON，请重试')
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

  return { enToCn, cnToEn, enExample: parsed.example }
}

// ── Image generation (optional) ─────────────────────────────────────────

const IMAGE_REWRITE_PROMPT = `You turn an English example sentence into a concise visual description for a text-to-image model.

Rules:
- Output ONLY the final English prompt, no explanation, no quotes, no markdown.
- Describe the concrete scene, subjects, action, and mood from the sentence.
- Do NOT include readable text, captions, or words in the image.
- End with this exact style suffix: ", flat illustration, soft pastel colors, centered, no text".`

/**
 * Rewrite an example sentence into a text-to-image prompt using the text LLM
 * (reuses the existing LLMConfig). Returns a single-line English prompt.
 */
export async function rewritePromptForImage(
  word: string,
  example: string,
  config: LLMConfig,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`

  const res = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: IMAGE_REWRITE_PROMPT },
        { role: 'user', content: `Word: ${word}\nExample: ${example}` },
      ],
      temperature: 0.7,
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Prompt 改写失败 (${res.status})`)
  }

  const json = await res.json()
  const content: string = (json.choices?.[0]?.message?.content ?? '').toString().trim()
  if (!content) throw new Error('Prompt 改写返回空内容')
  // Strip accidental surrounding quotes / code fences.
  return content.replace(/^["'`]+|["'`]+$/g, '').trim()
}

interface ImageApiResponse {
  data?: Array<{ url?: string; b64_json?: string }>
}

/**
 * Call an OpenAI-compatible /images/generations endpoint. Returns an image URL
 * (or a data URL as a fallback when the API only returns base64).
 */
export async function generateImage(
  prompt: string,
  config: ImageGenConfig,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${config.baseURL.replace(/\/+$/, '')}/images/generations`

  const res = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'url',
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`图片生成失败 (${res.status})`)
  }

  const json = (await res.json()) as ImageApiResponse
  const item = json.data?.[0]
  if (item?.url) return item.url
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
  throw new Error('图片生成响应缺少 url / b64_json 字段')
}

/**
 * Generate two flashcards (like generateCards); when imageConfig is provided,
 * additionally rewrite the example into a prompt and generate an image, then
 * embed it at the top of the en→cn card's back as markdown.
 *
 * Image-generation errors are swallowed — cards are always returned without an
 * image in that case.
 */
export async function generateCardsWithImage(
  word: string,
  config: LLMConfig,
  imageConfig: ImageGenConfig | null,
  signal?: AbortSignal,
): Promise<GeneratedCards> {
  const result = await generateCards(word, config, signal)

  if (!imageConfig || !result.enExample) return result

  try {
    const prompt = await rewritePromptForImage(word, result.enExample, config, signal)
    const imageUrl = await generateImage(prompt, imageConfig, signal)
    result.enToCn = {
      ...result.enToCn,
      back: `![${word}](${imageUrl})\n\n${result.enToCn.back}`,
    }
  } catch (err) {
    if (signal?.aborted) throw err
    // Swallow image errors: keep the card, just without an image.
    console.warn('[vibe-word] image generation failed, card saved without image:', err)
  }

  return result
}
