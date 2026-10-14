import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { fsrsTestDependency } from './fsrs-test-loader.mjs'
const cache = new Map(), values = new Map()
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, Date, Set, Map, console,
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: i => [...values.keys()][i], get length() { return values.size } },
    require: name => name === '@tauri-apps/api/core' ? {} : name === './log' ? { createLogger: () => ({ info() {}, debug() {}, error() {} }) } : name === './fsrs' ? fsrsTestDependency : load(path.resolve(path.dirname(file), name + '.ts')),
  })
  return module.exports
}
const tags = load('src/lib/tags.ts'), study = load('src/lib/study.ts'), storage = load('src/lib/storage.ts'), date = load('src/lib/date.ts')
const decks = [{ id: 'default', name: 'Default' }, { id: 'a', name: 'A' }, { id: 'child', name: 'Child', parentId: 'a' }, { id: 'b', name: 'B' }]
const cards = [{ id: 'a-x', deckId: 'a', tags: ['x', 'y'] }, { id: 'child-x', deckId: 'child', tags: ['x'] }, { id: 'b-y', deckId: 'b', tags: ['y'] }, { id: 'b-x', deckId: 'b', tags: ['x'] }, { id: 'empty' }]
const scope = { version: 2, mode: 'custom', rules: [{ deckIds: ['a'], tags: ['x'] }, { deckIds: ['b'], tags: ['y'] }] }
const ids = value => cards.filter(card => tags.matchesStudyScope(card, value, decks)).map(card => card.id).join(',')
assert.equal(ids(scope), 'a-x,child-x,b-y')
assert.equal(ids({ ...scope, rules: [...scope.rules, { deckIds: ['child', 'a'], tags: ['x', 'y'] }] }), 'a-x,child-x,b-y')
assert.equal(ids({ ...scope, rules: [{ deckIds: null, tags: ['x'] }] }), 'a-x,child-x,b-x')
assert.equal(ids({ ...scope, rules: [{ deckIds: ['b'], tags: null }] }), 'b-y,b-x')
assert.equal(ids(['']), 'empty')
assert.equal(ids(tags.normalizeStudyScope(['x'], 'a')), 'a-x,child-x')
assert.equal(ids(tags.normalizeStudyScope(null, 'b')), 'b-y,b-x')
assert.equal(ids(tags.normalizeStudyScope(null)), 'a-x,child-x,b-y,b-x,empty')
assert.equal(ids({ ...scope, rules: [{ deckIds: ['deleted'], tags: null }] }), '')
assert.equal(ids(tags.normalizeStudyScope({ version: 99 })), '')
assert.equal(tags.validStudyScope({ ...scope, rules: [{ deckIds: [], tags: null }] }), false)
assert.equal(tags.validStudyScope({ ...scope, rules: [{ deckIds: null, tags: [] }] }), false)
assert.equal(ids(tags.renameScopeTag(scope, 'x', 'z')), 'b-y')
assert.equal(ids(tags.renameScopeTag(scope, 'x', null)), ids(scope), 'deleted tags remain explicit references, never all tags')
const day = date.todayKey(), data = { progress: {}, controls: { 'child-x': { suspended: true } }, reviews: [], issued: {}, deckIssued: {} }
const selection = study.selectStudyCards(cards, data, { newCardsPerDay: 1 }, { newCardsDate: day, newCardsIssued: 0 }, scope, decks)
assert.equal(selection.matching.length, 3)
assert.equal(selection.fresh.length, 1)
assert.equal(selection.fresh[0].id, 'a-x')
assert.equal(study.selectStudyCards(cards, data, { newCardsPerDay: 1 }, { newCardsDate: day, newCardsIssued: 1 }, scope, decks).fresh.length, 0)
values.set('vibe-word:settings:v1', JSON.stringify({ newCardsPerDay: 10, studyDeckId: 'a', studyScope: ['x'] }))
assert.equal(ids((await storage.loadSettings()).studyScope), 'a-x,child-x')
await storage.saveSettings({ newCardsPerDay: 10, studyScope: scope })
assert.equal(ids((await storage.loadSettings()).studyScope), ids(scope))
assert.equal(JSON.parse(values.get('vibe-word:settings:v1')).studyScope.version, 2)
console.log('PASS composite scope: four scenarios, independent rules, hierarchy, deduplication, empty and missing selections, rename, quota, exclusions, migration and persistence')
