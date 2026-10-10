import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(file, deps = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Math, console, require: name => { if(name==='./fsrs') return fsrsTestDependency; assert.ok(name in deps, name); return deps[name] }, ...globals })
  return module.exports
}
const tags = load('src/lib/tags.ts')
const date = load('src/lib/date.ts')
const sm2 = load('src/lib/sm2.ts', { './date': date })
const scheduler = load('src/lib/scheduler.ts', { './date': date, './sm2': sm2 })
assert.equal(JSON.stringify(tags.parseTags(' work，旅行, work, ,')), '["work","旅行"]')
assert.equal(tags.matchesTag({ tags: ['work'] }, 'work'), true)
assert.equal(tags.matchesTag({}, ''), true)
assert.equal(tags.matchesTag({ tags: ['work'] }, ''), false)
const cards = [{ id: 'a', front: 'one', back: '1', tags: ['work', 'travel'] }, { id: 'b', tags: ['travel'] }, { id: 'c' }]
let result = scheduler.schedule(cards.filter(c => tags.matchesTag(c, 'work')), {}, { newCardsPerDay: 2 }, { newCardsDate: date.todayKey(), newCardsIssued: 1 })
assert.equal(result.newCards.length, 1)
assert.equal(result.newCards[0].id, 'a')
result = scheduler.schedule(cards.filter(c => tags.matchesTag(c, 'travel')), { a: {...sm2.initialState('a'),issuedAt:date.todayKey()} }, { newCardsPerDay: 2 }, result.meta)
assert.equal(result.newCards.length, 0, 'Tags share one daily budget')
assert.equal(result.dueReviews.length, 1, 'Multi-tag cards share one progress entry')
const data = new Map()
const storage = load('src/lib/storage.ts', { '@tauri-apps/api/core': {}, './decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags': tags, './date': date, './sm2': sm2, './log': { createLogger: () => ({ info() {}, debug() {}, error() {} }) } }, { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } })
await storage.saveOneCard(cards[0])
await storage.saveOneProgress(sm2.initialState('a'))
const before = data.get('vibe-word:progress:v1')
await storage.updateOneCard('a', 'one', '1', null, ['edited'])
assert.equal(JSON.stringify((await storage.loadCustomCards())[0].tags), '["edited"]')
assert.equal(data.get('vibe-word:progress:v1'), before)
await storage.updateOneCard('a', 'one', '1', null, [])
assert.equal((await storage.loadCustomCards())[0].tags.length, 0)
// Stateful render harness exercises the quick-learning flow without any storage dependency.
let elements = [], state = [], cursor = 0
const jsx = (type, props) => { const element = { type, props }; elements.push(element); return element }
const CardView = () => {}
const mod = { exports: {} }
const source = ts.transpileModule(fs.readFileSync('src/components/BrowsePage.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
const dependencies = {
  './CardEditor': { useCardEditor: () => () => {} },
  '../lib/cardStore': { allCards: async () => cards },
  '../hooks/useShortcuts': { useShortcuts: () => ({}) },
  '../lib/shortcuts': { shortcutAction: () => null },
  react: { useEffect() {}, useState(initial) { const key = cursor++; if (!(key in state)) state[key] = initial; return [state[key], value => { state[key] = typeof value === 'function' ? value(state[key]) : value }] } },
  '../lib/storage': {loadStudyData:async()=>({controls:{},reviews:[],progress:{},issued:{}})}, '../lib/study': load('src/lib/study.ts',{'./date':date,'./sm2':sm2,'./decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags':tags}),
  'react/jsx-runtime': { jsx, jsxs: jsx }, '../lib/i18n': { t: x => x }, '../lib/tags': tags, './CardView': { CardView },
}
vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => { if(name==='./fsrs') return fsrsTestDependency; assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name] } })
function render() { cursor = 0; elements = []; mod.exports.BrowsePage({ cards, onExit() {} }) }
function button(name) { return elements.find(e => e.type === 'button' && (Array.isArray(e.props.children) ? e.props.children.includes(name) : e.props.children === name)).props }
const allBefore = JSON.stringify([...data])
render()
assert.ok(!elements.some(e => e.type === CardView), 'Enter selection before showing cards')
elements.filter(e => e.type === 'input')[0].props.onChange({ target: { checked: false } }); render()
assert.equal(button('开始快速学习').disabled, true, 'Empty selection cannot start')
// Select two overlapping tags: card a should appear once, untagged c should stay out.
elements.filter(e => e.type === 'input')[2].props.onChange()
render()
elements.filter(e => e.type === 'input')[3].props.onChange()
render()
button('开始快速学习').onClick(); render()
assert.equal(state[6].length, 2)
let face = elements.find(e => e.type === CardView).props
const firstCard = face.card.id
assert.ok(['a','b'].includes(firstCard)); assert.equal(face.flipped, false)
face.onFlipChange(true); render()
button('下一张').onClick(); render()
face = elements.find(e => e.type === CardView).props
assert.equal(face.card.id, firstCard === 'a' ? 'b' : 'a'); assert.equal(face.flipped, false)
assert.equal(button('下一张').disabled, true)
button('上一张').onClick(); render()
assert.equal(elements.find(e => e.type === CardView).props.flipped, false)
button('重新选择标签').onClick(); render()
elements.filter(e => e.type === 'input')[0].props.onChange({ target: { checked: true } }); render()
button('开始快速学习').onClick(); render()
assert.equal(state[6].length, 3, 'All includes untagged cards')
assert.equal(JSON.stringify([...data]), allBefore)
console.log('PASS tag normalization, scoped scheduling, shared budget, persistence, multi-tag union, flip reset, and read-only quick learning')
