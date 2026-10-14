import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(path, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set, require: name => dependencies[name] })
  return module.exports
}
const date = load('src/lib/date.ts')
const sm2 = load('src/lib/sm2.ts', { './date': date })
const decksLib = load('src/lib/decks.ts', { './sm2': sm2 })
const tags = load('src/lib/tags.ts')
const study = load('src/lib/study.ts', { './forgotten': load('src/lib/forgotten.ts', {'./date':date}), './date': date, './sm2': sm2, './decks': decksLib, './tags': tags })
const decks = [{ id: 'default', name: 'Default' }, { id: 'parent', name: 'Parent', newCardsPerDay: 1 }, { id: 'child', name: 'Child', parentId: 'parent' }]
const cards = [{ id: 'outside' }, { id: 'parent-card', deckId: 'parent' }, { id: 'child-card', deckId: 'child' }]
const day = date.todayKey()
const data = { progress: {}, controls: {}, reviews: [], deckIssued: {} }
const select = id => study.selectStudyCards(cards.filter(c => decksLib.inDeck(c, id, decks)), data, { newCardsPerDay: 10 }, { newCardsDate: day, newCardsIssued: 0 }, null, decks)
assert.equal(select('parent').matching.map(c => c.id).join(','), 'parent-card,child-card')
assert.equal(select('parent').fresh.length, 1, 'parent daily quota is shared with descendants')
assert.equal(select('child').matching.map(c => c.id).join(','), 'child-card')
assert.equal(select('default').matching.map(c => c.id).join(','), 'outside')
assert.equal(select('deleted').matching.length, 0, 'deleted deck must not broaden to all cards')
data.controls['child-card'] = { suspended: true }
assert.equal(select('child').fresh.length, 0)
console.log('PASS deck study: descendants, default deck, deleted deck, parent quota, suspended cards')
