const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE})
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(String(e)))
 let mode='error',requests=0
 await page.route('https://retry.test/**',async route=>{
  requests++;const thisMode=mode
  if(thisMode==='slow')await new Promise(resolve=>setTimeout(resolve,800))
  const content={word:'retry phrase',phonetic:'/test/',definition:'测试释义',example:'A retry example.',exampleTranslation:'重试例句。',etymology:'测试',roots:'测试',similar:'test',chineseHint:'测试提示'}
  await route.fulfill({status:thisMode==='error'?500:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]})}).catch(()=>{})
 })
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:5189')
 await page.evaluate(async()=>{
  localStorage.clear();localStorage.setItem('vibe-word:language:v1','zh-Hans');localStorage.setItem('vibe-word:llm:v1',JSON.stringify({baseURL:'https://retry.test/v1',apiKey:'fixture',model:'test'}))
  const {generationQueue}=await import('/src/lib/generationQueue.ts');await generationQueue.initialize()
  const {saveAITasks}=await import('/src/lib/storage.ts')
  await saveAITasks({version:1,migratedImports:true,tasks:[{id:'failed',kind:'word',word:'failed phrase',requirements:'',status:'failed',enqueuedAt:Date.now()-3000,finishedAt:Date.now(),error:'Fixture API failed',drafts:[]},{id:'cancelled',kind:'word',word:'cancelled phrase',requirements:'',status:'cancelled',enqueuedAt:Date.now()-3000,finishedAt:Date.now(),drafts:[]}]})
 })
 await page.reload();await page.getByRole('button',{name:'任务队列',exact:true}).click()
 await page.getByRole('button',{name:'需处理',exact:true}).click()
 await page.getByRole('button',{name:'重试',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'API 请求失败'}).waitFor()
 assert.equal(requests,1)
 await page.screenshot({path:'design/generation-retry.png'})
 mode='ok';await page.getByRole('button',{name:'重试',exact:true}).click()
 await page.getByRole('button',{name:'待审核',exact:true}).click()
 await page.locator('.task-list').getByText('retry phrase',{exact:false}).first().waitFor()
 assert.equal(requests,2)
 // Previously cancelled tasks can be retried, cancelled again and restarted.
 await page.getByRole('button',{name:'已结束',exact:true}).click()
 mode='slow';await page.getByRole('button',{name:'重试',exact:true}).click()
 await page.getByRole('button',{name:'进行中',exact:true}).click()
 await page.getByRole('button',{name:'取消生成',exact:true}).click()
 await page.getByRole('button',{name:'已结束',exact:true}).click()
 mode='ok';await page.getByRole('button',{name:'重试',exact:true}).click()
 await page.getByRole('button',{name:'待审核',exact:true}).click()
 await page.waitForFunction(async()=>{const {loadAITasks}=await import('/src/lib/storage.ts');return (await loadAITasks()).tasks.every(t=>t.status==='review')})
 const state=await page.evaluate(async()=>{const {loadAITasks}=await import('/src/lib/storage.ts');return loadAITasks()})
 assert.equal(state.tasks.length,2);assert(state.tasks.every(t=>t.drafts.length===2));assert.deepEqual(errors,[])
 await browser.close();console.log('PASS retry UI: failed API retry, cancelled retry, cancel and restart, same task IDs, no duplicate drafts')
})().catch(e=>{console.error(e);process.exit(1)})
