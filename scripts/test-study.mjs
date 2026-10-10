import { fsrsTestDependency } from './fsrs-test-loader.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
function load(file,deps={},globals={}) {
 const module={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(code,{module,exports:module.exports,Date,Math,console,crypto:webcrypto,require:n=>{ if(n==='./fsrs') return fsrsTestDependency;assert.ok(n in deps,n);return deps[n]},...globals});return module.exports
}
const date=load('src/lib/date.ts'),sm2=load('src/lib/sm2.ts',{'./date':date}),tags=load('src/lib/tags.ts')
const study=load('src/lib/study.ts',{'./date':date,'./sm2':sm2,'./decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags':tags})
// Exercise sibling spacing with different pool sizes and seeded random orders.
let randomSeed = 42
const random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 4294967296)
for (const counts of [[2,2,2], [3,2,1], [4,3], [2,1,1], [5,1], [1], []]) {
 const pool = counts.flatMap((count,group)=>Array.from({length:count},(_,n)=>({id:`${group}-${n}`,noteId:`note-${group}`})))
 const before = JSON.stringify(pool)
 for(let repeat=0;repeat<100;repeat++) {
  const ordered = study.shuffleStudyCards(pool,random)
  assert.deepEqual([...ordered.map(c=>c.id)].sort(),pool.map(c=>c.id).sort())
  if (Math.max(0,...counts) <= Math.ceil(pool.length/2)) {
   assert.ok(ordered.every((c,i)=>!i || c.noteId!==ordered[i-1].noteId),`adjacent siblings: ${counts}`)
  }
 }
 assert.equal(JSON.stringify(pool),before)
}
const unlinked=Array.from({length:10},(_,n)=>({id:String(n)}))
const orders=new Set(Array.from({length:20},()=>study.shuffleStudyCards(unlinked,random).map(c=>c.id).join(',')))
assert.ok(orders.size>1)
console.log('PASS randomized sessions, sibling spacing, empty/single/dominant pools and unchanged inputs')
const now=new Date(2026,9,4,12).getTime(),today=date.todayKey(new Date(now))
const initial={...sm2.initialState('a',today),issuedAt:today}
const first=sm2.reviewGrade(initial,4,now)
assert.equal(first.learningDue,now+600000)
assert.equal(sm2.isDue(first,now+599999),false)
assert.equal(sm2.isDue(first,now+600000),true)
const graduated=sm2.reviewGrade(first,4,now+600000)
assert.equal(graduated.due,'2026-10-05');assert.equal(graduated.learningDue,null)
const cards=Array.from({length:7},(_,n)=>({id:String(n),front:`word ${n}`,back:'meaning'}))
const progress=Object.fromEntries(cards.map((c,n)=>[c.id,{...sm2.initialState(c.id,date.addDays(today,n)),lastReviewedAt:now-86400000}]))
assert.equal(study.aheadCards(cards,progress,{},1,now).map(c=>c.id).join(','),'1')
assert.equal(study.aheadCards(cards,progress,{'2':{suspended:true},'3':{buriedUntil:'2026-10-05'}},5,now).map(c=>c.id).join(','),'1,4,5')
assert.throws(()=>study.aheadCards(cards,progress,{},6,now))
progress['4'].learningDue=now+86400000
assert.equal(study.aheadCards(cards,progress,{},5,now).map(c=>c.id).join(','),'1,2,3,5')
const map=new Map(),localStorage={get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
const storage=load('src/lib/storage.ts',{'@tauri-apps/api/core':{},'./date':date,'./decks': load('src/lib/decks.ts', {'./sm2': load('src/lib/sm2.ts', {'./date': load('src/lib/date.ts')})}), './tags':tags,'./sm2':sm2,'./log':{createLogger:()=>({info(){},debug(){},error(){}})}},{localStorage})
await storage.saveOneCard({id:'a',front:'hello',back:'你好'})
await storage.saveOneProgress(sm2.initialState('a'))
await storage.saveSettings({newCardsPerDay:1})
assert.equal((await storage.issueNewCards(['a'])).join(','),'a')
assert.equal((await storage.loadMeta()).newCardsIssued,1)
assert.equal((await storage.issueNewCards(['a'])).length,0)
await storage.recordReview((await storage.loadProgress()).a,4)
let data=await storage.loadStudyData();assert.equal(data.reviews.length,1)
assert.ok(data.progress.a.learningDue>Date.now())
const id=data.reviews[0].id
await storage.undoReview(id)
data=await storage.loadStudyData();assert.equal(data.reviews[0].undone,true);assert.equal(data.progress.a.lastReviewedAt,null)
assert.equal((await storage.getDailyStats(date.todayKey(),date.todayKey())).length,0)
await storage.createBackup()
await storage.setCardControl('a',{suspended:true})
await assert.rejects(()=>storage.recordReview((data.progress).a,4))
const backups=await storage.listBackups(),manual=backups.find(b=>b.name.startsWith('manual-'))
await storage.restoreBackup(manual.name)
assert.equal((await storage.loadStudyData()).controls.a,undefined)
await storage.recordReview((await storage.loadProgress()).a,5)
const latest=(await storage.loadStudyData()).reviews.slice(-1)[0]
await storage.recordReview((await storage.loadProgress()).a,4)
await assert.rejects(()=>storage.undoReview(latest.id))
console.log('Study: learning persistence, 1–5 day boundaries, exclusions, issuance, undo, statistics, backups and stale undo passed')
if(process.argv.includes('--write-parity')) {
 const fixtures=[]
 for(const phase of ['new','learning','review','relearning']) for(const step of [0,1]) for(const q of [1,3,4,5]) {
  const previous={...sm2.initialState('parity',today),phase,learningStep:step,issuedAt:today,
    lastReviewedAt:phase==='new'?null:now-86400000,interval:phase==='review'?30:1,repetitions:phase==='review'?8:0}
  fixtures.push({previous,quality:q,now,next:sm2.reviewGrade(previous,q,now)})
 }
 fs.writeFileSync('ios/Tests/VibeWordCoreTests/Fixtures/study-parity.json',JSON.stringify(fixtures,null,2)+'\n')
}

// Tag scope preview is read-only and shares the real session selection rules.
const tagged = [
 {id:'both',tags:['work','travel'],noteId:'pair'}, {id:'sibling',tags:['work'],noteId:'pair'},
 {id:'travel',tags:['travel']}, {id:'untagged'}, {id:'paused',tags:['work']},
 {id:'buried',tags:['work']}, {id:'future',tags:['work']}, {id:'due',tags:['work']},
]
const scopeData={controls:{paused:{suspended:true},buried:{buriedUntil:date.addDays(date.todayKey(),1)}},reviews:[],issued:{},progress:{
 future:{...sm2.initialState('future'),lastReviewedAt:Date.now(),due:date.addDays(date.todayKey(),2)},
 due:{...sm2.initialState('due'),lastReviewedAt:Date.now()-86400000,due:date.todayKey()},
}}
const scopeMeta={newCardsDate:date.todayKey(),newCardsIssued:0}
const beforeScope=JSON.stringify(scopeData)
let selected=study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},scopeMeta,['work','travel'])
assert.equal(selected.fresh.map(c=>c.id).join(','),'both,travel')
assert.equal(selected.reviews.map(c=>c.id).join(','),'due')
assert.equal(JSON.stringify(scopeData),beforeScope)
selected=study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},{...scopeMeta,newCardsIssued:2},['work'])
assert.equal(selected.fresh.length,0); assert.equal(selected.reviews.length,1)
assert.equal(study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},scopeMeta,[]).matching.length,0)
assert.equal(study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},scopeMeta,['']).matching[0].id,'untagged')
assert.equal(study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},scopeMeta,['missing']).matching.length,0)
assert.equal(study.selectStudyCards(tagged,scopeData,{newCardsPerDay:2},scopeMeta,null).matching.length,tagged.length)
await storage.saveSettings({newCardsPerDay:2,studyScope:['work','travel']})
assert.equal((await storage.loadSettings()).studyScope.join(','),'travel,work')
await storage.saveSettings({newCardsPerDay:2,studyScope:null})
assert.equal((await storage.loadSettings()).studyScope,null)
console.log('PASS multi-tag union, untagged/empty/missing scopes, exclusions, sibling deduplication, shared quota, read-only preview and saved scope')
