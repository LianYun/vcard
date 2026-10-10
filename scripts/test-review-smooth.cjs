const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
 const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 const errors = []; page.on('pageerror', e => errors.push(String(e)));
 await page.addInitScript(() => {
  localStorage.setItem('vibe-word:language:v1', 'zh-Hans');
  const date = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const gradeModule = import('/src/lib/sm2.ts');
  const state = id => ({ cardId:id, ease:2.5, interval:6, repetitions:2, due:date(0), phase:'review', lastReviewedAt:Date.now()-86400000 });
  const cards = Array.from({length:2000}, (_,i) => ({ id:`perf:${i}`, front:`smooth-word-${i}`, back:`**Answer ${i}**\n\n${'A long synthetic definition and example. '.repeat(12)}`, createdAt: 2000-i }));
  const progress = Object.fromEntries(cards.map((c,i)=>[c.id,{...state(c.id), due:date(i<120?0:1)}]));
  const reviews = Array.from({length:50000},(_,i)=>({ id:`history:${i}`, cardId:cards[i%cards.length].id, quality:4, day:date(0), timestamp:Date.now()-86400000, before:state(cards[i%cards.length].id), after:state(cards[i%cards.length].id), algorithm:'sm2-steps-v1'}));
  let revision = 0, syncRevision = 0; const controls = {};
  window.__rpc = []; window.__rpcSamples = []; window.__failReview = false; window.__reviewDelay = 0;
  window.__startDelay = 0; window.__failStart = false;
  window.__importSuspended = id => { controls[id] = {suspended:true}; syncRevision++; revision++; }; window.__lockRequests = 0;
  const request = navigator.locks.request.bind(navigator.locks);
  navigator.locks.request = (...args) => { window.__lockRequests++; return request(...args); };
  window.__TAURI_INTERNALS__ = { invoke:async(cmd,input={}) => {
   if(cmd==='native_cloud_storage') return true;
   if(cmd==='get_setting') return null;
   if(cmd!=='cloud_storage') return null;
   const {command,args={}}=input; const rpcStart=performance.now(); window.__rpc.push(command); if(command==='review') {window.__rpcStart=performance.now(); window.__lastReviewId=args.id;}
   let result;
   switch(command) {
    case 'cards': result=cards; break;
    case 'studyData': result={progress:args.ids?Object.fromEntries(args.ids.filter(id=>progress[id]).map(id=>[id,progress[id]])):progress, controls, reviews:args.includeReviews===false?[]:reviews, issued:{},deckIssued:{}}; break;
    case 'decks':result=[{id:'default',name:'默认牌组'}];break;
    case 'settings':result={newCardsPerDay:10,studyScope:null};break;
    case 'meta':result={newCardsDate:date(0),newCardsIssued:0};break;
    case 'stats':result=[];break;
    case 'llm':case 'image':result={baseURL:'',apiKey:'',model:''};break;
    case 'status':result={revision,syncRevision,enabled:false,folder:'',message:''};break;
    case 'issue':result=[];break;
    case 'startStudy': {
     if(window.__startDelay) await new Promise(resolve=>setTimeout(resolve,window.__startDelay));
     if(window.__failStart) throw Error('fixture start write failed');
     const selected=cards.filter(card=>!controls[card.id]?.suspended && (progress[card.id].due<=date(0) || progress[card.id].learningDue!=null));
     result={cards:selected,data:{progress:Object.fromEntries(selected.map(card=>[card.id,progress[card.id]])),controls,reviews:[],issued:{}},emptyReason:'当前范围暂无待学卡片',timings:{}};break;
    }
    case 'review': {
     if(window.__reviewDelay) await new Promise(resolve=>setTimeout(resolve,window.__reviewDelay));
     if(window.__failReview) throw Error('fixture disk full');
     const {reviewGrade}=await gradeModule; const timestamp=Date.now();const before=progress[args.id];
     const next=reviewGrade(before,args.quality,timestamp); progress[args.id]=next;
     const record={id:`rating:${revision}`,cardId:args.id,before,after:next,quality:args.quality,timestamp,day:date(0),algorithm:'sm2-steps-v1'};reviews.push(record);revision++;
     result={...next,reviewId:record.id,controlUpdates:{},record,revision};break;
    }
    case 'reviewHistory':result=reviews.filter(r=>r.cardId===args.id).slice(-20).reverse();break;
    case 'undoReview': {
     const record=reviews.find(r=>r.id===args.id); record.undone=true; progress[record.cardId]=record.before; revision++; result=null;break;
    }
    default:result=[];
   }
   const encoded=JSON.stringify(result); const wire=JSON.parse(encoded);
   window.__rpcSamples.push({command,ms:performance.now()-rpcStart,bytes:encoded.length});
   if(command==='review') window.__rpcEnd=performance.now(); return wire;
  }};
 });
 await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5193');
 if(process.argv.includes('--start-performance')) {
  await page.getByRole('button',{name:'开始学习',exact:true}).first().waitFor();
  // Let home prefetch finish so it cannot contaminate startup RPC measurements.
  await page.waitForFunction(()=>window.__rpcSamples.some(row=>row.command==='studyData' && row.bytes>1000000));
  const baseline=await page.evaluate(async()=>{
   const storage=await import('/src/lib/storage.ts'), {selectStudyCards,shuffleStudyCards}=await import('/src/lib/study.ts');
   const rows=[];
   for(let i=0;i<5;i++) {
    const started=performance.now(), rpcOffset=window.__rpcSamples.length;
    const [cards,data,settings,meta,decks]=await Promise.all([storage.loadCustomCards(),storage.loadStudyData({includeReviews:false}),storage.loadSettings(),storage.loadMeta(),storage.loadDecks()]);
    const readEnd=performance.now();const selection=selectStudyCards(cards,data,settings,meta,null,decks);const selectEnd=performance.now();
    const issued=new Set(await storage.issueNewCards(selection.fresh.map(c=>c.id)));const issueEnd=performance.now();
    const selected=shuffleStudyCards([...selection.reviews,...selection.fresh.filter(c=>issued.has(c.id))]);
    await storage.loadStudyData({cardIds:selected.map(c=>c.id),includeReviews:false});
    rows.push({totalMs:performance.now()-started,readMs:readEnd-started,selectionMs:selectEnd-readEnd,issueMs:issueEnd-selectEnd,reloadMs:performance.now()-issueEnd,cards:selected.length,rpc:window.__rpcSamples.slice(rpcOffset)});
   }
   return rows;
  });
  const starts=[];
  for(let i=0;i<5;i++) {
   starts.push(await page.evaluate(async()=>{
    const offset=window.__rpc.length, started=performance.now();
    document.querySelector('.study-start-button').click();
    await new Promise((resolve,reject)=>{const tick=()=>{
     if(document.querySelector('.study-card .card-face-front')) resolve();
     else if(performance.now()-started>5000) reject(Error('start timeout'));else requestAnimationFrame(tick);
    };requestAnimationFrame(tick);});
    return {paintMs:performance.now()-started,rpc:window.__rpc.slice(offset)};
   }));
   assert.deepEqual(starts[i].rpc,['startStudy']);
   await page.getByRole('button',{name:'‹ 返回',exact:true}).click();
   await page.waitForTimeout(150);
  }
  // Startup still waits for the durable reply, and failures can be retried.
  await page.evaluate(()=>{window.__startDelay=250;window.__failStart=true;});
  await page.getByRole('button',{name:'开始学习',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:'准备中'}).waitFor();
  assert.equal(await page.locator('.study-card').count(),0);
  await page.getByRole('alert').filter({hasText:'fixture start write failed'}).waitFor();
  await page.evaluate(()=>{window.__startDelay=0;window.__failStart=false;});
  await page.getByRole('button',{name:'重新检查',exact:true}).filter({visible:true}).click();
  await page.locator('.study-card').waitFor();
  console.log(JSON.stringify({baseline,starts,errors,checks:'7 RPC to 1, repeated start, delayed durable reply, failed startup retry'}));
  await browser.close();assert.deepEqual(errors,[]);return;
 }
 await page.getByRole('button',{name:'开始学习',exact:true}).first().click();
 await page.locator('.study-card').waitFor();
 const samples=[];
 for(let i=0;i<8;i++) {
  await page.locator('.study-card').click();
  samples.push(await page.evaluate(async index => {
   const commands=window.__rpc.length;
   const button=document.querySelector('.study-grade.'+['again','hard','good','easy'][index%4]);
   const current=document.querySelector('.study-card').textContent;
   const started=performance.now();let domTime=0;
   const observer=new MutationObserver(()=>{const front=document.querySelector('.study-card .card-face-front');if(front&&!current.includes(front.textContent.trim())&&!domTime)domTime=performance.now();});observer.observe(document.querySelector('.study-shell'),{subtree:true,childList:true,attributes:true});button.click();
   await new Promise((resolve,reject)=>{const tick=()=>{
    const front=document.querySelector('.study-card .card-face-front');
    if(front && !current.includes(front.textContent.trim())) resolve();
    else if(performance.now()-started>5000) reject(Error('next card never rendered'));else requestAnimationFrame(tick);
   };requestAnimationFrame(tick);});
   observer.disconnect();return {ms:performance.now()-started,dom:domTime-started,rpcMs:window.__rpcEnd-window.__rpcStart,renderMs:domTime-window.__rpcEnd,rpc:window.__rpc.slice(commands)};
  },i));
 }
 assert(samples.every(sample => sample.rpc.length === 1 && sample.rpc[0] === 'review'), 'Rating must not reload full study data/cards/decks');
 assert.equal(await page.evaluate(()=>window.__lockRequests),0, 'Native worker already serializes writes');
 // A local status revision must not reload hidden library pages every five seconds.
 const beforePoll = await page.evaluate(()=>window.__rpc.length);
 await page.waitForTimeout(5200);
 const polling = await page.evaluate(start=>window.__rpc.slice(start),beforePoll);
 assert(!polling.some(command=>['studyData','cards','decks'].includes(command)),JSON.stringify(polling));
 // Delayed durable writes keep the current card; duplicate clicks cannot create two ratings.
 const oldFront=await page.locator('.study-card').innerText();
 const ratingsBefore=await page.evaluate(()=>window.__rpc.filter(c=>c==='review').length);
 await page.evaluate(()=>{window.__reviewDelay=150;const button=document.querySelector('.study-grade.easy');button.click();button.click();});
 await page.waitForTimeout(40);
 assert.equal(await page.locator('.study-card').innerText(),oldFront);
 assert.equal(await page.locator('.study-grade.easy').evaluate(button=>getComputedStyle(button).opacity),'1');
 await page.waitForFunction(text=>document.querySelector('.study-card')?.innerText!==text,oldFront);
 await page.evaluate(()=>window.__reviewDelay=0);
 assert.equal(await page.evaluate(()=>window.__rpc.filter(c=>c==='review').length),ratingsBefore+1);
 // Undo restores the exact pre-review state, including a card removed from the queue.
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await page.getByRole('button',{name:'撤销评分',exact:true}).click();
 await page.waitForFunction(text=>document.querySelector('.study-card')?.innerText===text,oldFront);
 // Failed writes keep the same revealed card; a successful refresh permits retry.
 await page.locator('.study-card').click();
 const answer=await page.locator('.study-card').innerText();
 await page.evaluate(()=>window.__failReview=true);
 await page.locator('.study-grade.hard').click();
 await page.locator('[role="alert"]').filter({hasText:'fixture disk full'}).waitFor();
 assert.equal(await page.locator('.study-card').innerText(),answer);
 await page.evaluate(()=>window.__failReview=false);
 await page.getByRole('button',{name:'重新检查',exact:true}).filter({visible:true}).click();
 await page.locator('.study-grade.hard').waitFor();
 // Actual imported changes still refresh the active queue.
 const currentId=await page.evaluate(()=>window.__lastReviewId);
 await page.evaluate(id=>window.__importSuspended(id),currentId);
 await page.waitForFunction(id=>{const front=document.querySelector('.study-card .card-face-front');return front&&!front.innerText.includes(`smooth-word-${id.split(':')[1]}`);},currentId,{timeout:7000});
 console.log(JSON.stringify({samples,errors,checks:'no full refresh on grading/poll, no native browser lock, delayed save, duplicate click, undo, failure recovery, real import refresh'}));
 await browser.close(); assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exit(1)});
