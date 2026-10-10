import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/shortcuts.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module, exports:module.exports})
const { DEFAULT_SHORTCUTS: defaults, normalizeShortcuts, validShortcuts, shortcutAction } = module.exports
assert.equal(validShortcuts(defaults), true)
assert.equal(validShortcuts({...defaults, good:'a'}), false)
assert.equal(validShortcuts({...defaults, flip:'Enter'}), false)
assert.equal(validShortcuts({...defaults, good:'', easy:''}), true)
assert.equal(normalizeShortcuts(null).flip, ' ')
assert.equal(normalizeShortcuts({...defaults, good:'a'}).good, 'd')
const custom = {...defaults, good:'x'}
const event = {key:'x', target:{closest:()=>null}}
assert.equal(shortcutAction(event, custom), 'good')
assert.equal(shortcutAction({...event,key:'d'}, custom), undefined)
for (const flag of ['isComposing','repeat','metaKey','ctrlKey','altKey','shiftKey','defaultPrevented']) assert.equal(shortcutAction({...event,[flag]:true},custom), undefined)
assert.equal(shortcutAction({...event,target:{closest:()=>({})}},custom), undefined)
assert.equal(shortcutAction({...event,key:' '},custom),'flip')
assert.equal(shortcutAction({...event,key:'ArrowLeft'},custom),'previous')
console.log('PASS: custom keys, defaults, duplicate/invalid bindings, disabled bindings, typing and modifier guards')
