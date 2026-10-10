import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
const require=createRequire(import.meta.url),cache=new Map()
function load(file,globals={}) {
 file=path.resolve(file);if(cache.has(file))return cache.get(file)
 const module={exports:{}};cache.set(file,module.exports)
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(code,{module,exports:module.exports,Date,Math,console,crypto:webcrypto,structuredClone,require:n=>n==='./log'?{createLogger:()=>({info(){},debug(){},error(){}})}:n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts'),globals):n==='@tauri-apps/api/core'?{}:require(n),...globals});return module.exports
}
const core=load('src/lib/fsrs.ts'),{initialState}=load('src/lib/sm2.ts')
const now=new Date(2026,9,8,12).getTime(), config=structuredClone(core.DEFAULT_SCHEDULER)
const fresh=initialState('fixture','2026-10-08')
let out=core.fsrsPreview(fresh,config,now)
assert.equal(out[1].learningDue-now,60000);assert.equal(out[3].learningDue-now,330000);assert.equal(out[4].learningDue-now,600000);assert.equal(out[5].phase,'review')
assert.equal(core.fsrsPreview(out[4],config,now+600000)[3].learningDue-(now+600000),600000)
const learned={...fresh,phase:'review',interval:15,ease:2.6,repetitions:3,lastReviewedAt:now-15*86400000}
out=core.fsrsPreview(learned,config,now)
assert.ok(out[3].interval<out[4].interval&&out[4].interval<out[5].interval)
assert.equal(out[1].learningDue-now,600000)
const capped=core.fsrsPreview(learned,{...config,maximumInterval:1},now)
assert.equal(capped[3].interval,1);assert.equal(capped[4].interval,1);assert.equal(capped[5].interval,1)
assert.ok(core.fsrsPreview(learned,{...config,retention:.95},now)[4].interval<out[4].interval)
assert.ok(core.fsrsPreview({...learned,lastReviewedAt:now-3*86400000},config,now)[4].interval<out[4].interval)
assert.equal(core.migrateState(learned,[],config).due,learned.due)
assert.equal(core.migrateState(learned,[],config).fsrs.source,'estimated')
const fixtures=[]
for(const retention of [.8,.9,.95])for(const phase of ['new','learning','review','relearning'])for(const step of [0,1])for(const elapsed of [0,1,15,100]) {
 const c={...config,retention}
 const previous={...learned,phase,learningStep:step,lastReviewedAt:phase==='new'?null:now-elapsed*86400000}
 const next=core.fsrsPreview(previous,c,now)
 for(const quality of [1,3,4,5])fixtures.push({previous,config:c,now,quality,next:next[quality]})
}
fs.writeFileSync('ios/Tests/VibeWordCoreTests/Fixtures/fsrs-parity.json',JSON.stringify(fixtures,null,2)+'\n')
// Contiguous history is replayed, undone records are excluded, migration is idempotent.
let state=fresh,history=[]
for(let i=0;i<6;i++) {const timestamp=now+i*86400000,after=core.fsrsPreview(state,config,timestamp)[4];history.push({id:String(i),cardId:state.cardId,before:state,after,quality:4,timestamp,day:'2026-10-08',algorithm:'test'});state=after}
const legacy={...state};delete legacy.fsrs
const migrated=core.migrateState(legacy,history,config)
assert.equal(migrated.fsrs.source,'history');assert.equal(migrated.fsrs.stability,state.fsrs.stability)
assert.equal(core.migrateState(migrated,history,config),migrated)
assert.throws(()=>core.optimizeParameters(history,config),/200/)
assert.throws(()=>core.validateConfig({...config,weights:[NaN]}))
// Browser migration, atomic grading, exact preview/commit, stale config refusal, undo and backup.
const map=new Map(),localStorage={get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
const globals={localStorage,window:{dispatchEvent(){}},Event:class {}}
cache.clear();const storage=load('src/lib/storage.ts',globals)
await storage.saveOneCard({id:'fixture',front:'hello',back:'你好'})
await storage.saveOneProgress(learned)
let data=await storage.loadStudyData(),before=data.progress.fixture
const timestamp=Date.now(),context={now:timestamp,configId:config.id,before}
const expected=core.fsrsPreview(before,config,timestamp)[4]
const committed=await storage.recordReview(before,4,context)
assert.equal(committed.interval,expected.interval);assert.equal(committed.due,expected.due);assert.equal(committed.fsrs.stability,expected.fsrs.stability)
assert.ok(map.has('vibe-word:study:v3'));assert.ok((await storage.listBackups()).length)
await assert.rejects(()=>storage.recordReview(before,4,context),/变化/)
await storage.undoReview(committed.reviewId)
data=await storage.loadStudyData();assert.equal(data.progress.fixture.lastReviewedAt,before.lastReviewedAt)
const updated={...config,id:'updated',retention:.95}
await storage.saveSchedulerConfig(updated,config.id)
await assert.rejects(()=>storage.saveSchedulerConfig({...config,id:'other'},config.id),/变化/)
assert.equal((await storage.loadSchedulerConfig()).id,'updated')
console.log(`PASS FSRS: ${fixtures.length} cross-language fixtures, steps, cap, retention, timing, migration, exact commit, stale state/config, undo and backup`)
// Exercise the real optimizer with synthetic, labelled histories; never user data.
const trainingHistory=[]
for(let n=0;n<20;n++) {
 let s=initialState(`fit:${n}`,'2026-01-01')
 for(let i=0;i<24;i++) {
  const timestamp=now-(80-i*3)*86400000+n*1000,quality=(i+n)%4===0?1:(i+n)%5===0?3:(i+n)%7===0?5:4
  const after=core.fsrsPreview(s,config,timestamp)[quality]
  trainingHistory.push({id:`fit-${i}-${n}`,cardId:s.cardId,before:s,after,quality,timestamp,day:todayKeyForTest(timestamp),algorithm:'test',undone:false})
  s=after
 }
}
function todayKeyForTest(timestamp){const d=new Date(timestamp);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const fit=core.optimizeParameters(trainingHistory,config)
assert.ok(fit.accepted);assert.ok(fit.candidateLoss<fit.baselineLoss-.001);core.validateConfig(fit.config)
fs.writeFileSync('ios/Tests/VibeWordCoreTests/Fixtures/fsrs-optimizer.json',JSON.stringify({history:trainingHistory,config,result:fit})+'\n')
console.log(`PASS optimizer: independent holdout ${fit.validation}, loss ${fit.baselineLoss.toFixed(4)} → ${fit.candidateLoss.toFixed(4)}`)
const timezone=process.env.TZ
process.env.TZ='America/New_York'
assert.equal(core.elapsedDays(new Date(2026,2,7,12).getTime(),new Date(2026,2,8,12).getTime()),1)
assert.equal(core.elapsedDays(new Date(2026,9,31,12).getTime(),new Date(2026,10,1,12).getTime()),1)
if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone
await storage.setCardControl('fixture',{suspended:true})
assert.equal(await storage.rescheduleAll('updated'),0)
await storage.setCardControl('fixture',{suspended:false})
assert.equal(await storage.rescheduleAll('updated'),1)
await assert.rejects(()=>storage.rescheduleAll('stale'),/变化/)
console.log('PASS DST calendar boundaries, suspended-card exclusion and stale reschedule protection')
