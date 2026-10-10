import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const english = JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8'))
const data = new Map(), events = {}, document = { documentElement: { lang: '' } }
const navigator = { languages: ['zh-CN', 'en-US'] }
function load(file, deps, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if(name==='./fsrs') return fsrsTestDependency;
    assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]
  }, ...globals })
  return module.exports
}
const storage = load('src/lib/storage.ts', {
  './decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags': load('src/lib/tags.ts'), '@tauri-apps/api/core': {}, './log': { createLogger: () => ({ info() {} }) }, './sm2': {}, './date': {},
}, { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } })
function create() {
  return load('src/lib/i18n.ts', { react: { useSyncExternalStore() {} }, '../locales/en.json': { default: english }, './storage': storage }, {
    navigator, document, window: { addEventListener: (name, listener) => { events[name] = listener } },
  })
}
let api = create()
assert.equal(storage.loadLanguage(), 'system')
assert.equal(api.currentLanguage(), 'zh-Hans')
assert.equal(api.resolveLanguage('system', ['en-GB', 'zh']), 'en')
assert.equal(api.resolveLanguage('system', ['zh-Hant-TW', 'en']), 'zh-Hans')
assert.equal(api.resolveLanguage('system', ['fr-FR']), 'en')
api.setLanguage('en')
assert.equal(api.t('设置'), 'Settings')
assert.equal(document.documentElement.lang, 'en')
assert.equal(api.t('已添加：{0}', '中文 {1}'), 'Added: 中文 {1}')
assert.equal(api.localizedMessage('已连接 My Folder；等待同步'), 'Connected to My Folder; waiting to sync')
api = create()
assert.equal(api.currentLanguage(), 'en', 'Preference survives a fresh module load')
api.setLanguage('system')
navigator.languages = ['en-US']
events.languagechange()
assert.equal(document.documentElement.lang, 'en')
navigator.languages = ['zh-CN']
events.languagechange()
assert.equal(document.documentElement.lang, 'zh-Hans')
api.setLanguage('zh-Hans')
navigator.languages = ['en-US']; events.languagechange()
assert.equal(api.t('设置'), '设置', 'Explicit preference overrides system changes')
data.set('vibe-word:language:v1', '"invalid"')
assert.equal(storage.loadLanguage(), 'system')
console.log('PASS system resolution, explicit overrides, persistence, system changes, and safe interpolation')

for (const [key, value] of Object.entries(english)) {
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), key)
}
for (const file of ['src/App.tsx', ...fs.readdirSync('src/components').filter(f => f.endsWith('.tsx')).map(f => `src/components/${f}`)]) {
  const root = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(root) === 't' && ts.isStringLiteral(node.arguments[0])) {
      assert.ok(node.arguments[0].text in english, `Missing translation in ${file}: ${node.arguments[0].text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
}
console.log('PASS translation coverage and placeholder parity')
for (const directory of ['ios/VibeWord/App', 'ios/WatchApp', 'ios/WatchWidgets']) {
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.swift'))) {
    const file = `${directory}/${name}`
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bL\(("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(match[1])
      assert.ok(key in english, `Missing native translation in ${file}: ${key}`)
    }
  }
}
console.log('PASS native UI translation coverage')
