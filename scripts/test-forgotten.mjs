import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(path, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map, require: name => dependencies[name] })
  return module.exports
}
const date = load('src/lib/date.ts')
const { recentForgottenCards } = load('src/lib/forgotten.ts', { './date': date })
const cards = Array.from({length:12}, (_, i) => ({id:`card-${i}`}))
const reviews = cards.map(c => ({cardId:c.id, quality:1, day:'2026-10-08'}))
reviews.push({cardId:'card-11', quality:1, day:'2026-10-14'})
const original = JSON.stringify({cards,reviews})
const result = recentForgottenCards(cards,reviews,'2026-10-14')
assert.equal(result.length,12, 'all cards included, not only top ten')
assert.equal(result[0].id,'card-11', 'most frequently forgotten first')
assert.equal(new Set(result.map(c=>c.id)).size,12)
const boundary = [
 {cardId:'old',day:'2026-10-07',quality:1},
 {cardId:'future',day:'2026-10-15',quality:1},
 {cardId:'undone',day:'2026-10-14',quality:1,undone:true},
 {cardId:'good',day:'2026-10-14',quality:4},
 {cardId:'deleted',day:'2026-10-14',quality:1},
]
assert.equal(recentForgottenCards(boundary.filter(r=>r.cardId!=='deleted').map(r=>({id:r.cardId})),boundary,'2026-10-14').length,0)
assert.equal(JSON.stringify({cards,reviews}),original)
console.log('PASS forgotten: date boundaries, undone, deleted, grading, ordering, unique cards, no top-ten cap, immutable inputs')
