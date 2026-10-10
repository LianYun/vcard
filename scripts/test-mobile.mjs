import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, console, Date, Math,
    AbortController, DOMException, Response, Headers, crypto, structuredClone, setTimeout, clearTimeout,
    require: name => { if(name==='./fsrs') return fsrsTestDependency; assert.ok(name in dependencies, name); return dependencies[name] }, ...globals })
  return module.exports
}
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick() }
  assert.ok(predicate(), 'Expected queue transition')
}
const jobs = [], saved = []
let config = { baseURL: 'https://fixture.invalid', apiKey: 'fixture', model: 'old' }
const { generationQueue: queue } = load('src/lib/generationQueue.ts', {
  './documentImport': {},
  './llm': { generateCardsWithImage: (word, config, image, signal) => new Promise(resolve => jobs.push({ word, config, signal, resolve })) },
  './storage': { loadImageGenConfig: async () => null,
    loadAITasks: async () => ({ version: 1, tasks: [], migratedImports: true }), saveAITasks: async () => {},
    loadLLMConfig: async () => ({ ...config }), confirmAIDraft: async (id, card) => { saved.push(card.front) } },
})
const first = await queue.enqueue('a')
await queue.enqueue('b'); await queue.enqueue('c')
await until(() => jobs.length === 3)
await queue.enqueue('d')
config = { ...config, model: 'new' }
assert.equal(jobs.length, 3)
await queue.cancel(first.id)
assert.equal(jobs[0].signal.aborted, true)
// Cancellation must retain its worker slot until the request actually settles.
assert.equal(jobs.length, 3)
const result = word => ({ enToCn: { front: word }, cnToEn: { front: word + '-reverse' } })
jobs[0].resolve(result('a')); await until(() => jobs.length === 4)
assert.equal(saved.length, 0)
assert.equal(jobs.length, 4)
assert.equal(jobs[3].config.model, 'new')
for (const job of jobs.slice(1)) job.resolve(result(job.word))
await until(() => queue.getSnapshot().filter(t => t.status === 'review').length === 3)
assert.equal(saved.length, 0, 'Generated drafts require explicit confirmation')
for (const task of queue.getSnapshot().filter(t => t.status === 'review')) {
  for (const draft of task.drafts) await queue.confirm(task.id, draft.id)
}
assert.equal(saved.length, 6)
assert.equal(queue.getSnapshot().filter(t => t.status === 'done').length, 3)
console.log('PASS queue configuration snapshots, cancellation, concurrency and persistence boundary')

const data = new Map()
const storage = load('src/lib/storage.ts', {
  './decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags': load('src/lib/tags.ts'), '@tauri-apps/api/core': {}, './log': { createLogger: () => ({ info() {}, debug() {}, error() {} }) },
  './sm2': {}, './date': load('src/lib/date.ts'),
}, { localStorage: { get length(){return data.size}, key:i=>[...data.keys()][i], removeItem:k=>data.delete(k), getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) } })
await storage.saveOneCard({ id: 'test', front: 'test', back: '' })
await storage.saveOneProgress({ cardId: 'test' })
await storage.deleteOneCard('test')
assert.equal((await storage.loadCustomCards()).length, 0)
assert.equal(Object.keys(await storage.loadProgress()).length, 0)
const full = load('src/lib/storage.ts', {
  './decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags': load('src/lib/tags.ts'), '@tauri-apps/api/core': {}, './log': { createLogger: () => ({ info() {} }) }, './sm2': {}, './date': load('src/lib/date.ts'),
}, { localStorage: { getItem: () => null, setItem() { throw Error('quota') } } })
await assert.rejects(full.saveSettings({ newCardsPerDay: 10 }), /本地保存失败/)
console.log('PASS deletion clears progress; quota failures are surfaced')

const window = { VibeAndroid: { request(id) { this.id = id }, cancelRequest() {} } }
const { apiFetch } = load('src/lib/android.ts', {}, { window })
for (const status of [204, 205, 304, 200]) {
  const pending = apiFetch('https://example.com/v1/chat/completions', {})
  window.__vibeNativeResponse(window.VibeAndroid.id, status, '', null)
  assert.equal((await pending).status, status)
}
const invalid = apiFetch('https://example.com', {})
window.__vibeNativeResponse(window.VibeAndroid.id, 0, '', null)
await assert.rejects(invalid, /无效的 HTTP/)
console.log('PASS Android empty-body and invalid HTTP responses settle correctly')

const { generateCards } = load('src/lib/llm.ts', { './storage': {loadLanguage:()=> 'zh-Hans'}, './android': {
  apiFetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"word":"invalid"}' } }] })),
} })
await assert.rejects(generateCards('test', { baseURL: 'https://example.com', apiKey: 'test', model: 'test' }), /无法解析/)
console.log('PASS malformed AI card fields are rejected')
