import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'

function load(file, deps) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in deps, name); return deps[name] }, crypto: webcrypto, AbortController, setTimeout, clearTimeout, console })
  return module.exports
}
let requests = [], abortPending = false
const response = { word: 'cue', phonetic: '/kjuː/', definition: '提示', example: 'A cue triggers a response.', exampleTranslation: '提示触发反应。', etymology: '线索', roots: '整体记忆', similar: 'signal', chineseHint: '提示信号' }
const llm = load('src/lib/llm.ts', { './storage': { loadImportImage: async id => { assert.equal(id, 'image-fixture'); return 'data:image/jpeg;base64,fixture' } }, './android': { apiFetch: async (url, options) => {
  requests.push(JSON.parse(options.body))
  if (abortPending) return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted'))) })
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }
} } })
let persisted = [], acceptCalls = 0, candidatesCalls = 0, failGeneration = false, persistedError = false
const storage = {
  loadImportJobs: async () => structuredClone(persisted),
  saveImportJobs: async jobs => { if (persistedError) throw Error('disk full'); persisted = structuredClone(jobs) },
  loadLLMConfig: async () => ({ baseURL: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'test' }),
}
const api = load('src/lib/documentImport.ts', {
  react: { useSyncExternalStore() {} },
  './cardStore': { allCards: async () => [{ front: 'cue' }], acceptImportDraft: async () => { acceptCalls++ } },
  './storage': storage,
  './llm': { ...llm, requestModel: async () => { candidatesCalls++; return JSON.stringify({ candidates: [{ word: 'cue', quote: 'A cue triggers a response.' }] }) },
    generateCardsFromMessages: async (...args) => { if (failGeneration) throw Error('temporary model failure'); return llm.generateCardsFromMessages(...args) } },
})
const source = { id: 'page-1', label: '第 1 页', text: 'A cue triggers a response.' }
assert.equal(api.parseCandidates('{"candidates":[]}', source).length, 0)
assert.throws(() => api.parseCandidates('{"candidates":[{"word":"invented","quote":"fake"}]}', source))
const long = 'x'.repeat(16000)
const chunks = api.splitDocument([{ ...source, text: long }])
assert.ok(chunks.every(x => x.text.length <= 6000))
assert.equal(chunks.map(x => x.text).join('').length, 17000, '500-character overlap across boundaries')
const store = api.documentImports
await store.initialize()
const id = await store.create({ name: 'fixture.pdf', sections: [source], warnings: [] }, 2, true, '保留原文例句')
failGeneration = true
await store.run(id)
assert.equal(store.getSnapshot().jobs[0].drafts[0].status, 'failed')
failGeneration = false
await store.run(id)
assert.equal(candidatesCalls, 1, 'Resume does not redo successful extraction')
let draft = store.getSnapshot().jobs[0].drafts[0]
assert.equal(draft.status, 'ready')
assert.equal(draft.duplicate, true)
assert.equal(acceptCalls, 0, 'Generating never writes to card library')
const original = JSON.stringify(draft.cards)
requests = []
const proposal = await store.regenerate(id, draft.id, '释义有误，请按原文修正，并缩短反向提示')
assert.equal(JSON.stringify(draft.cards), original, 'Regeneration preserves old draft until adoption')
const messages = requests[0].messages
assert.deepEqual(JSON.parse(JSON.stringify(messages.slice(0, draft.prompt.length))), JSON.parse(JSON.stringify(draft.prompt)))
const instruction = JSON.parse(messages.at(-1).content)
assert.equal(instruction.userGuidance, '释义有误，请按原文修正，并缩短反向提示')
assert.deepEqual(instruction.originalCards, JSON.parse(original))
assert.ok(messages[0].content.includes('JSON'))
assert.ok(messages[1].content.includes('保留原文例句'))
await assert.rejects(() => store.regenerate(id, draft.id, ' '))
abortPending = true
const pending = store.regenerate(id, draft.id, '停止测试')
await new Promise(resolve => setTimeout(resolve, 10))
store.stop()
await assert.rejects(pending)
abortPending = false
assert.equal(JSON.stringify(draft.cards), original)
await assert.rejects(() => store.replace(id, draft.id, proposal, { ...draft.cards, enToCn: { ...draft.cards.enToCn, front: 'stale' } }))
assert.equal(JSON.stringify(draft.cards), original, 'Stale editor does not overwrite a newer draft')
await store.replace(id, draft.id, proposal)
await store.remove(id, [draft.id]); assert.equal(draft.status, 'deleted')
await store.remove(id, [draft.id], true); assert.equal(draft.status, 'ready')
await store.accept(id, [draft.id]); await store.accept(id, [draft.id])
assert.equal(acceptCalls, 1)
assert.equal(draft.status, 'accepted')
await assert.rejects(() => store.regenerate(id, draft.id, '不得重生成已接受卡片'))
await store.remove(id, [draft.id]); assert.equal(draft.status, 'accepted')
persistedError = true
await assert.rejects(() => store.create({ name: 'new.pdf', sections: [source], warnings: [] }, 1, false, ''))
assert.equal(store.getSnapshot().jobs.length, 1, 'Failed creation leaves no phantom task')
console.log('PASS: source validation, chunking, extraction resume, partial failure retry, full regeneration payload, cancellation, draft isolation, adoption, deletion/undo, acceptance guard, failed persistence')

const visualSource = { ...source, text: '', imageId: 'image-fixture' }
assert.equal(api.splitDocument([visualSource]).length, 1, 'Image-only pages are not dropped')
assert.equal(api.splitDocument([visualSource, source]).length, 2, 'Never merge text into image pages')
assert.equal(api.parseCandidates('{"candidates":[{"word":"cue","quote":"A cue appears on the page."}]}', visualSource).length, 1)
const visualPrompt = api.generationPrompt('cue', visualSource, 'A cue appears on the page.', 'Read diagram labels')
const visualDraft = { ...draft, prompt: visualPrompt }
const regen = api.regenerationPrompt(visualDraft, 'The arrow label was misread')
assert.equal(regen[1].content[1].image_url.url, 'import-image:image-fixture')
const cfg = { baseURL: 'https://fixture.invalid', apiKey: 'fixture', model: 'vision', supportsImages: true }
await assert.rejects(() => llm.resolveMessageImages(regen, { ...cfg, supportsImages: false }))
requests = []
await llm.generateCardsFromMessages(regen, cfg)
assert.equal(requests[0].messages[1].content[1].image_url.url, 'data:image/jpeg;base64,fixture')
assert.equal(requests[0].messages[1].content[1].image_url.detail, 'high')
assert.equal(JSON.parse(requests[0].messages.at(-1).content).userGuidance, 'The arrow label was misread')
assert.equal(visualPrompt[1].content[1].image_url.url, 'import-image:image-fixture', 'Original stored prompt keeps local ref')
console.log('PASS: image-only pages, multimodal extraction/generation/regeneration, image resolution, capability gate and immutable prompts')
