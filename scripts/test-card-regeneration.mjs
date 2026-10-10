import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const data = new Map()
let failWrite = false, response = '', request
function load(file, deps, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { if(name==='./fsrs') return fsrsTestDependency; assert.ok(name in deps, name); return deps[name] }, AbortController, setTimeout, clearTimeout, console, ...globals })
  return module.exports
}
const storage = load('src/lib/storage.ts', {
  './decks': {}, './tags': {}, '@tauri-apps/api/core': {}, './log': { createLogger: () => ({ info() {} }) }, './sm2': {}, './date': {},
}, { localStorage: { getItem: key => data.get(key), setItem: (key, value) => { if (failWrite) throw Error('full'); data.set(key, value) } }, window: { dispatchEvent() {} }, Event: class {} })
const llm = load('src/lib/llm.ts', { './storage': {}, './android': { apiFetch: async (url, options) => {
  request = JSON.parse(options.body)
  const content = typeof response === 'function' ? response(request) : response
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
} } })
const original = { id: 'original', front: '中文问题', back: 'English answer', example: 'Old example', tags: ['tag'], deckId: 'deck', noteId: 'note', createdAt: 12 }
const sibling = { ...original, id: 'sibling' }
const draft = { front: '新问题', back: 'New answer', example: '' }
const key = 'vibe-word:cards:v1'
const reset = () => data.set(key, JSON.stringify([original, sibling]))
reset();data.set('vibe-word:study:v3', 'progress and history sentinel')
const config = { baseURL: 'https://test.invalid/v1', model: 'test', apiKey: 'fixture' }
response = '```json\n'+JSON.stringify(draft)+'\n```'
const generated = await llm.regenerateCard(original, '简化', config)
assert.equal(generated.back, draft.back)
assert.equal(JSON.parse(request.messages[1].content).requirements, '简化')
assert.equal(JSON.parse(request.messages[1].content).front, original.front)
assert.deepEqual(JSON.parse(data.get(key)), [original, sibling], 'generation must not persist')
const audio = `<audio controls preload="none" src="data:audio/mpeg;base64,${'A'.repeat(22848)}"></audio>`
const imageURL = `data:image/png;base64,${'B'.repeat(30000)}`
const mediaCard = { ...original, front: `Question ![diagram](${imageURL})`, back: `- _wired to_ ${audio}\n-`, example: 'Listen: vibe-media:voice.mp3' }
response = request => {
  const input = JSON.parse(request.messages[1].content)
  assert.ok(JSON.stringify(request).length < 2000, 'binary attachments must not inflate model requests')
  assert.ok(!JSON.stringify(request).includes('base64,'))
  assert.ok(!input.back.includes('<audio'))
  return JSON.stringify({ front: input.front, back: input.back.replace('_wired to_', '**wired to**'), example: input.example })
}
const restored = await llm.regenerateCard(mediaCard, '', config)
assert.equal(restored.front, mediaCard.front)
assert.equal(restored.back, mediaCard.back.replace('_wired to_', '**wired to**'))
assert.equal(restored.example, mediaCard.example)
// Omitted markers retain media on the original face, even when example becomes empty.
response = JSON.stringify({ front: 'Question', back: 'Answer', example: '' })
const omitted = await llm.regenerateCard(mediaCard, '', config)
assert.equal(omitted.front, `Question\n\n![diagram](${imageURL})`)
assert.equal(omitted.back, `Answer\n\n${audio}`)
assert.equal(omitted.example, 'vibe-media:voice.mp3')
// Reject duplicate, unknown, moved and partially rewritten markers.
for (const transform of [
  input => ({ ...input, back: input.back + input.back }),
  input => ({ ...input, back: input.back.replace('VIBE_ATTACHMENT_1', 'VIBE_ATTACHMENT_99') }),
  input => ({ ...input, front: input.back, back: input.front }),
  input => ({ ...input, back: input.back.replace('[[VIBE_ATTACHMENT_1]]', '[[VIBE_ATTACHMENT_1]') }),
]) {
  response = request => JSON.stringify(transform(JSON.parse(request.messages[1].content)))
  await assert.rejects(llm.regenerateCard(mediaCard, '', config), /无法解析/)
}
// Literal marker-like source text cannot collide with generated markers; repeated
// references are restored independently without recursive substitution.
const repeated = { ...original, back: `[[VIBE_ATTACHMENT_0]] ${audio} ${audio}` }
response = request => {
  const input = JSON.parse(request.messages[1].content)
  assert.ok(input.back.includes('[[VIBE_ATTACHMENT__0]]'))
  assert.ok(input.back.includes('[[VIBE_ATTACHMENT__1]]'))
  return JSON.stringify(input)
}
assert.equal((await llm.regenerateCard(repeated, '', config)).back, repeated.back)
assert.deepEqual(JSON.parse(data.get(key)), [original, sibling], 'media regeneration must not persist')
for (const invalid of ['{}', '{"front":"","back":"answer","example":""}', '{"front":"Q","back":"A","example":3}', 'nonsense']) {
  response = invalid; await assert.rejects(llm.regenerateCard(original, '', config))
}
const aborted = new AbortController();aborted.abort();await assert.rejects(llm.regenerateCard(original, '', config, aborted.signal))
await storage.replaceRegeneratedCard(original, draft)
const cards = JSON.parse(data.get(key))
assert.deepEqual(cards[0], JSON.parse(JSON.stringify({ ...original, ...draft, example: undefined })))
assert.deepEqual(cards[1], sibling)
assert.equal(data.get('vibe-word:study:v3'), 'progress and history sentinel')
await assert.rejects(storage.replaceRegeneratedCard(original, draft), /已更新/)
reset();data.set(key, JSON.stringify([{ ...original, tags: ['new tag'], deckId: 'new deck' }, sibling]));await storage.replaceRegeneratedCard(original, draft)
assert.deepEqual(JSON.parse(data.get(key))[0].tags, ['new tag'])
assert.equal(JSON.parse(data.get(key))[0].deckId, 'new deck')
data.set(key, '[]');await assert.rejects(storage.replaceRegeneratedCard(original, draft), /已删除/)
reset();failWrite = true;await assert.rejects(storage.replaceRegeneratedCard(original, draft), /保存失败/);failWrite = false
assert.deepEqual(JSON.parse(data.get(key)), [original, sibling])
await assert.rejects(storage.replaceRegeneratedCard({ ...original, anki: {} }, draft), /Anki/)
console.log('PASS regeneration media request size, exact restoration, omission recovery, marker validation/collisions, parsing/cancellation, preview isolation, content conflict, deletion, disk failure, metadata/progress/sibling preservation')
