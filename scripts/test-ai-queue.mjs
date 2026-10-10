import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { randomUUID } from 'node:crypto'
function load(file, deps, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in deps, name); return deps[name] }, AbortController, structuredClone, crypto: { randomUUID }, console, ...globals })
  return module.exports
}
let disk = { version: 1, tasks: [] }, failResult = false, formal = new Map(), requests = 0, active = 0, peak = 0
const calls = []
let delay = false, late = false
const pending = []
const pair = { enToCn: { id: '', front: 'word', back: 'meaning' }, cnToEn: { id: '', front: 'meaning', back: 'word' } }
const storage = {
  loadAITasks: async () => structuredClone(disk), saveAITasks: async state => {
    assert.ok(!JSON.stringify(state).includes('SECRET'))
    if (failResult && state.tasks.some(t => t.drafts.length && t.status === 'review')) { failResult = false; throw Error('disk full') }
    disk = structuredClone(state)
  }, supportsDocumentImport: async () => false,
  loadLLMConfig: async () => ({ baseURL: 'https://fixture.invalid', apiKey: 'SECRET', model: 'fixture' }), loadImageGenConfig: async () => null,
  confirmAIDraft: async (id, card, expected) => { if (!formal.has(id)) { formal.set(id, card); calls.push({ id, card, expected }) } },
}
const llm = {
  generateCardsWithImage: async (_word, _config, _image, signal) => {
    requests++; active++; peak = Math.max(peak, active)
    try {
      if (delay) await new Promise((resolve, reject) => { pending.push(resolve); if (!late) signal.addEventListener('abort', () => reject(Error('cancelled'))) })
      return structuredClone(pair)
    } finally { active-- }
  }, regenerateCard: async (_card, guidance) => ({ front: 'new front', back: guidance || 'new back', example: '' }),
}
const document = load('src/lib/documentImport.ts', { react: {}, './cardStore': {}, './llm': {}, './storage': {} })
const { GenerationQueue } = load('src/lib/generationQueue.ts', { './storage': storage, './llm': llm, './documentImport': document })
const wait = async (condition) => { for (let n = 0; n < 300; n++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)) }; throw Error('timed out') }
const queue = new GenerationQueue()
await queue.initialize()
const task = await queue.enqueue('word')
await wait(() => queue.getSnapshot()[0].status === 'review')
assert.equal(formal.size, 0)
let [first, second] = queue.getSnapshot()[0].drafts
assert.equal(first.card.noteId, second.card.noteId)
await queue.saveDraft(task.id, first.id, { ...first.card, back: 'edited', tags: ['tag'], deckId: 'deck' }, first.revision)
await Promise.all([queue.confirm(task.id, first.id), queue.confirm(task.id, first.id)])
assert.equal(formal.size, 1); assert.equal(calls[0].card.back, 'edited'); assert.equal(queue.getSnapshot()[0].drafts[1].status, 'ready')
await queue.discard(task.id, second.id)
assert.equal(queue.getSnapshot()[0].status, 'done')
const restart = new GenerationQueue(); await restart.initialize()
assert.equal(restart.getSnapshot()[0].drafts[0].status, 'accepted')
// Persistence failure retains generated results in memory, allowing storage retry
// without an extra paid AI request.
failResult = true
const failed = await queue.enqueue('save failure')
await wait(() => queue.getSnapshot().find(t => t.id === failed.id)?.status === 'failed')
const beforeRetry = requests
await queue.resume(failed.id)
await wait(() => queue.getSnapshot().find(t => t.id === failed.id)?.status === 'review')
assert.equal(requests, beforeRetry)
// Three global workers within the application; late responses after cancellation
// never install drafts.
delay = true; late = true
const ids = []
for (let n = 0; n < 5; n++) ids.push((await queue.enqueue('slow ' + n)).id)
await wait(() => active === 3)
assert.equal(peak, 3)
await queue.cancel(ids[0])
while (pending.length) pending.shift()()
await wait(() => { while (pending.length) pending.shift()(); return queue.getSnapshot().filter(t => ids.includes(t.id)).every(t => ['review', 'cancelled'].includes(t.status)) })
assert.equal(queue.getSnapshot().find(t => t.id === ids[0]).drafts.length, 0)
assert.equal(peak, 3)
delay = false; late = false
// Paused records remain durable and are not auto-run after restart.
await queue.pause(ids[1])
const recovered = new GenerationQueue(); const beforeRestore = requests; await recovered.initialize()
assert.equal(requests, beforeRestore)
assert.equal(recovered.getSnapshot().find(t => t.id === ids[1]).status, 'paused')
// Draft regeneration cannot overwrite editing performed while its request runs.
const original = queue.getSnapshot().find(t => t.id === failed.id).drafts[0]
let finishReplacement
llm.regenerateCard = async () => new Promise(resolve => { finishReplacement = resolve })
const regeneration = await queue.enqueueDraft(failed.id, original.id, 'rewrite')
await wait(() => !!finishReplacement)
await queue.saveDraft(failed.id, original.id, { ...original.card, back: 'user edit' }, original.revision)
finishReplacement({ front: 'late', back: 'late', example: '' })
await wait(() => queue.getSnapshot().find(t => t.id === regeneration.id).status === 'failed')
assert.equal(queue.getSnapshot().find(t => t.id === failed.id).drafts[0].card.back, 'user edit')
// Old Mac imports split into per-card drafts and retain accepted IDs.
disk = { version: 1, tasks: [] }
storage.supportsDocumentImport = async () => true
storage.loadImportJobs = async () => [{ id: 'legacy', createdAt: 1, guidance: '', status: 'review', analyzed: 1, target: 1, reverse: true, document: { name: 'doc', sections: [], warnings: [] }, drafts: [{ id: 'entry', word: 'word', source: { id: 's', label: 'page 1', text: '' }, quote: '', prompt: [], status: 'accepted', cards: pair }] }]
const migrated = new GenerationQueue(); await migrated.initialize()
assert.equal(migrated.getSnapshot()[0].drafts.length, 2)
assert.ok(migrated.getSnapshot()[0].drafts.every(d => d.status === 'accepted' && d.card.id.startsWith('custom:import:legacy:entry:')))
assert.equal(formal.size, 1)
// New document tasks share the executor and resume after candidate generation
// failure without redoing extraction or writing any formal cards.
llm.requestModel = async () => JSON.stringify({ candidates: [{ word: 'cue', quote: 'A cue matters.' }] })
let extractions = 0
const requestModel = llm.requestModel
llm.requestModel = async (...args) => { extractions++; return requestModel(...args) }
let failDocument = true
llm.generateCardsFromMessages = async () => { if (failDocument) { failDocument = false; throw Error('temporary'); }; return structuredClone(pair) }
const docTask = await migrated.enqueueDocument({ name: 'new.txt', sections: [{ id: 'p', label: 'Paragraph 1', text: 'A cue matters.' }], warnings: [] }, 1, true, 'context')
await wait(() => migrated.getSnapshot().find(t => t.id === docTask.id)?.status === 'failed')
assert.equal(extractions, 1)
await migrated.resume(docTask.id)
await wait(() => migrated.getSnapshot().find(t => t.id === docTask.id)?.status === 'review')
assert.equal(extractions, 1)
assert.equal(migrated.getSnapshot().find(t => t.id === docTask.id).drafts.length, 2)
assert.equal(formal.size, 1)
// A cancelled record that already contains reviewed drafts can be resumed
// without generating again or resetting an accepted direction.
await migrated.cancel(docTask.id)
const docDraft = migrated.getSnapshot().find(t => t.id === docTask.id).drafts[0]
await migrated.confirm(docTask.id, docDraft.id)
await migrated.resume(docTask.id)
await wait(() => migrated.getSnapshot().find(t => t.id === docTask.id)?.status === 'review')
assert.equal(migrated.getSnapshot().find(t => t.id === docTask.id).drafts[0].status, 'accepted')
console.log('PASS queue concurrency, review isolation, independent confirmation, editing, crash recovery, cancellation, storage retry, stale draft protection, document continuation and legacy migration')
