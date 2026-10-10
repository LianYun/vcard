import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'

const requests = []
let config = { baseURL: 'https://fixture.invalid', apiKey: 'fixture', model: 'first-model' }
let writesFail = false
const module = { exports: {} }
const deps = {
  './storage': { loadAITasks: async () => ({ version: 1, tasks: [], migratedImports: true }), saveAITasks: async () => { if (writesFail) throw new Error('Save failed') }, loadLLMConfig: async () => ({ ...config }), loadImageGenConfig: async () => null },
  './llm': { generateCardsWithImage: (word, model, image, signal) => new Promise((resolve, reject) => requests.push({ word, model, signal, resolve, reject })) },
  './documentImport': {},
}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/generationQueue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, require: name => { assert(name in deps, name); return deps[name] }, structuredClone, AbortController, crypto: webcrypto, Date, console })
const { GenerationQueue } = module.exports
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick() } assert(predicate(), 'Expected queue transition') }
const result = word => ({ enToCn: { id: 'forward', front: word, back: 'answer' }, cnToEn: { id: 'reverse', front: 'answer', back: word } })

const failed = new GenerationQueue(), task = await failed.enqueue('same phrase')
await until(() => requests.length === 1)
requests[0].reject(new Error('API failed'))
await until(() => failed.getSnapshot()[0].status === 'failed')
assert(failed.getSnapshot()[0].finishedAt)
config.model = 'updated-model'
await Promise.all([failed.resume(task.id), failed.resume(task.id)])
await until(() => requests.length === 2)
assert.equal(requests[1].word, task.word); assert.equal(requests[1].model.model, 'updated-model')
assert.equal(failed.getSnapshot()[0].error, undefined)
assert.equal(failed.getSnapshot()[0].finishedAt, undefined)
requests[1].resolve(result('fresh result'))
await until(() => failed.getSnapshot()[0].status === 'review')
assert.equal(failed.getSnapshot().length, 1); assert.equal(failed.getSnapshot()[0].id, task.id)
assert.equal(failed.getSnapshot()[0].drafts.length, 2)

const cancelled = new GenerationQueue(), cancelTask = await cancelled.enqueue('cancel phrase')
await until(() => requests.length === 3)
await cancelled.cancel(cancelTask.id)
assert(requests[2].signal.aborted)
assert.equal(cancelled.getSnapshot()[0].status, 'cancelled')
await cancelled.resume(cancelTask.id)
assert.equal(cancelled.getSnapshot()[0].status, 'queued')
assert.equal(requests.length, 3, 'Old request still owns its worker slot')
await cancelled.resume(cancelTask.id)
requests[2].resolve(result('stale cancelled result'))
await until(() => requests.length === 4)
requests[3].resolve(result('new cancelled retry'))
await until(() => cancelled.getSnapshot()[0].status === 'review')
assert.equal(cancelled.getSnapshot()[0].drafts[0].card.front, 'new cancelled retry')
assert.equal(cancelled.getSnapshot().length, 1)

const storageFailure = new GenerationQueue(), storageTask = await storageFailure.enqueue('save retry')
await until(() => requests.length === 5)
requests[4].reject(new Error('API failed'))
await until(() => storageFailure.getSnapshot()[0].status === 'failed')
writesFail = true
await assert.rejects(storageFailure.resume(storageTask.id), /Save failed/)
assert.equal(storageFailure.getSnapshot()[0].status, 'failed')
writesFail = false
await storageFailure.resume(storageTask.id)
await until(() => requests.length === 6)
requests[5].resolve(result('saved retry'))
await until(() => storageFailure.getSnapshot()[0].status === 'review')
console.log('PASS retry: same task/phrase, current model, error/time reset, duplicate-click dedup, immediate cancellation retry waits for old worker, stale result rejection, save failure retry')
