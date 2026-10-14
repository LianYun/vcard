import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { fsrsTestDependency } from './fsrs-test-loader.mjs'
const data = new Map()
let failAt = Infinity, writes = 0
const localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (++writes >= failAt) throw Error('quota'); data.set(key, value) }, removeItem: key => data.delete(key) }
function load(file, deps = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require(name) { assert.ok(name in deps, name); return deps[name] }, console, Date, localStorage, window: { dispatchEvent() {} }, Event: class {}, ...globals })
  return module.exports
}
const date = load('src/lib/date.ts'), sm2 = load('src/lib/sm2.ts', { './date': date }), tags = load('src/lib/tags.ts')
const storage = load('src/lib/storage.ts', { './date': date, './sm2': sm2, './tags': tags, './decks': {}, './fsrs': fsrsTestDependency, './log': { createLogger: () => ({ info() {} }) }, '@tauri-apps/api/core': {} })
const card = { id: 'custom:ai:one', front: 'word', back: 'meaning', noteId: 'pair', tags: [] }
// Fail after writing a journal and one target key. Reads cannot observe partial
// state while the storage is full; clearing the gate completes the same receipt.
failAt = 3
await assert.rejects(storage.confirmAIDraft('one', card), /quota/)
assert.ok(data.has('vibe-word:ai-commit-pending:v1'))
await assert.rejects(storage.loadCustomCards(), /quota/)
failAt = Infinity
assert.equal((await storage.loadCustomCards()).length, 1)
assert.equal(data.has('vibe-word:ai-commit-pending:v1'), false)
await storage.confirmAIDraft('one', card)
assert.equal(JSON.parse(data.get('vibe-word:daily-stats:v1'))[date.todayKey()].added, 1)
const seeded = await storage.loadStudyData()
assert.equal(seeded.progress[card.id].issuedAt, undefined)
seeded.progress[card.id].interval = 30; seeded.progress[card.id].repetitions = 4
seeded.reviews.push({ id: 'history-sentinel' })
data.set('vibe-word:study:v3', JSON.stringify(seeded))
const progressBefore = data.get('vibe-word:study:v3')
await storage.confirmAIDraft('replace', { ...card, back: 'new answer', tags: ['edited'] }, card)
assert.equal(data.get('vibe-word:study:v3'), progressBefore)
assert.equal(JSON.parse(data.get('vibe-word:daily-stats:v1'))[date.todayKey()].added, 1)
await storage.confirmAIDraft('replace', { ...card, back: 'new answer' }, card)
assert.equal((await storage.loadCustomCards())[0].tags[0], 'edited')
await assert.rejects(storage.confirmAIDraft('stale', { ...card, back: 'stale' }, card), /内容已更新/)
data.set('vibe-word:cards:v1', '[]')
await storage.confirmAIDraft('one', card)
assert.equal((await storage.loadCustomCards()).length, 0, 'Receipts never resurrect deleted cards')
await assert.rejects(storage.confirmAIDraft('deleted', card, card), /已删除/)
console.log('PASS browser atomic journal recovery, quota gating, confirmation receipts, deletion, replacement conflicts and progress/stat preservation')

// Native saves must send only changed tasks, and a failed write must not move
// the reference baseline (otherwise the retry would silently omit its changes).
const nativeCalls = []
let nativeFailure = false
const initialTasks = { version: 1, migratedImports: true, tasks: [
  { id: 'old', status: 'done', drafts: [{ card: { back: 'x'.repeat(500_000) } }] },
  { id: 'current', status: 'review', drafts: [] },
] }
const native = load('src/lib/storage.ts', {
  './date': date, './sm2': sm2, './tags': tags, './decks': {}, './fsrs': fsrsTestDependency,
  './log': { createLogger: () => ({ info() {}, debug() {}, error() {} }) },
  '@tauri-apps/api/core': { invoke: async (command, payload) => {
    if (command === 'native_cloud_storage') return true
    if (payload.command === 'aiTasks') return structuredClone(initialTasks)
    assert.equal(payload.command, 'patchAITasks')
    nativeCalls.push(payload.args)
    if (nativeFailure) throw Error('disk full')
  } },
}, { window: { __TAURI_INTERNALS__: {}, dispatchEvent() {} } })
const loaded = await native.loadAITasks()
await native.saveAITasks(loaded)
assert.equal(nativeCalls.at(-1).tasks.length, 0)
const changed = { ...loaded, tasks: [loaded.tasks[0], { ...loaded.tasks[1], status: 'done' }] }
nativeFailure = true
await assert.rejects(native.saveAITasks(changed), /disk full/)
nativeFailure = false
await native.saveAITasks(changed)
assert.equal(nativeCalls.at(-1).tasks.length, 1)
assert.equal(nativeCalls.at(-1).tasks[0].id, 'current')
assert.ok(JSON.stringify(nativeCalls.at(-1)).length < 1000)
await native.saveAITasks({ ...changed, tasks: [changed.tasks[1]] })
assert.equal(nativeCalls.at(-1).tasks.length, 0)
assert.equal(nativeCalls.at(-1).order.join(), 'current')
console.log('PASS native incremental payload, failed-write retry and task removal')
