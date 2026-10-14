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
const { calendarForecast } = load('src/lib/studyCalendar.ts', { './date': date })
const today = '2026-10-12'
const state = (due, extra = {}) => ({ due, lastReviewedAt: 1, ...extra })
const data = { progress: {
  overdue: state('2026-10-01'), future: state('2026-10-13'), new: state(today, { lastReviewedAt: null }),
  suspended: state(today), buried: state(today), learning: state('2026-10-15', { learningDue: new Date(2026, 9, 12, 23).getTime() }),
  deleted: state(today), nextYear: state('2027-01-01'),
}, controls: { suspended: { suspended: true }, buried: { buriedUntil: '2026-10-14' } } }
const cards = Object.keys(data.progress).filter(id => id !== 'deleted').map(id => ({ id }))
const before = JSON.stringify(data)
const result = calendarForecast(cards, data, today)
assert.equal(result.get(today).map(c => c.id).join(','), 'overdue,learning')
assert.equal(result.get('2026-10-13')[0].id, 'future')
assert.equal(result.get('2026-10-14')[0].id, 'buried')
assert.equal(result.get('2027-01-01')[0].id, 'nextYear')
assert.equal([...result.values()].flat().length, 5)
assert.equal(result.has('2026-10-01'), false)
assert.equal(JSON.stringify(data), before)
assert.equal(calendarForecast([], data, today).size, 0)
console.log('PASS calendar: overdue, future, new, suspended, buried, short-step, deleted, year boundary, empty, immutable inputs')
