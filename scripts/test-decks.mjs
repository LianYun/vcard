import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(file,deps={},globals={}) {
 const module={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(code,{module,exports:module.exports,Date,Math,console,require:n=>{ if(n==='./fsrs') return fsrsTestDependency;assert.ok(n in deps,n);return deps[n]},...globals});return module.exports
}
const date=load('src/lib/date.ts'),sm2=load('src/lib/sm2.ts',{'./date':date}),decks=load('src/lib/decks.ts',{'./sm2':sm2}),tags=load('src/lib/tags.ts')
const map=new Map(),localStorage={get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
const storage=load('src/lib/storage.ts',{'@tauri-apps/api/core':{},'./date':date,'./tags':tags,'./sm2':sm2,'./decks':decks,'./log':{createLogger:()=>({info(){},debug(){},error(){}})}},{localStorage,window:{dispatchEvent(){},addEventListener(){}},Event:class{}})
await storage.saveDeck({id:'parent',name:'English',newCardsPerDay:1})
await storage.saveDeck({id:'child',name:'Words',parentId:'parent'})
await storage.saveOneCard({id:'a',front:'A',back:'a',deckId:'child'})
await storage.saveOneCard({id:'b',front:'B',back:'b',deckId:'child'})
assert.equal(decks.deckPath('child',await storage.loadDecks()),'English::Words')
assert.equal((await storage.issueNewCards(['a','b'])).join(','),'a')
await storage.moveCards(['a'],'default')
assert.equal((await storage.issueNewCards(['b'])).length,0,'moving cards must not replenish source budget')
await assert.rejects(()=>storage.saveDeck({id:'parent',name:'cycle',parentId:'child'}))
assert.equal((await storage.loadProgress()).a.issuedAt,date.todayKey())
await storage.deleteDeck('child')
assert.equal((await storage.loadCustomCards()).find(c=>c.id==='b').deckId,'default')
assert.equal((await storage.loadProgress()).a.issuedAt,date.todayKey())
assert.equal((await storage.issueNewCards(['b'])).join(','),'b')
assert.equal((await storage.loadMeta()).newCardsIssued,2)
console.log('PASS persisted deck tree, ancestor limits, card move budget stability, cycles, safe deck deletion, global budget')
