// Exercise real editor and import UI with a mocked native transport. Native
// template/event semantics are verified separately by CardEditorTests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE})
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(String(e)))
 await page.addInitScript(()=>{
  const source={id:'source',label:'Chapter 1',text:'An original context.'}
  const pair={enToCn:{id:'forward',front:'word',back:'meaning',example:'example'},cnToEn:{id:'reverse',front:'meaning',back:'word',example:'reverse example'}}
  window.editorFixture={jobs:[{version:1,id:'job',createdAt:Date.now(),document:{name:'fixture.txt',sections:[source],warnings:[]},target:1,reverse:true,guidance:'',chunks:[source],analyzed:1,drafts:[{id:'draft',word:'word',source,quote:'An original context.',prompt:[],status:'ready',cards:pair}],status:'review'}],saved:null}
  localStorage.setItem('vibe-word:language:v1','zh-Hans')
  localStorage.setItem('vibe-word:cards:v1',JSON.stringify([{id:'anki',front:'Original front',back:'Original back',createdAt:Date.now()/1000,noteId:'note',anki:{guid:'g',model:'Basic',fields:{Text:'Original text'},question:'{{Text}}',answer:'{{Text}}',css:'',ordinal:0,cloze:false}}]))
 })
 await page.route('**/src/lib/storage.ts*',async route=>{
  const response=await route.fetch();let body=await response.text()
  const injections={
   'async function supportsDocumentImport() {':'return true;',
   'async function loadImportJobs() {':'return structuredClone(window.editorFixture.jobs);',
   'async function saveImportJobs(jobs) {':'window.editorFixture.jobs = structuredClone(jobs); return;',
   'async function previewAnkiEdit(id, fields) {':`if (!fields.Text.trim()) throw new Error('Invalid field'); return {cards:[{id,front:'Preview '+fields.Text,back:'Preview answer'}],added:0,removed:0};`,
   'async function saveEditedCard(expected, draft, fields) {':`window.editorFixture.saved={expected,draft,fields}; return;`
  }
  for(const [signature,code] of Object.entries(injections)){assert(body.includes(signature),signature);body=body.replace(signature,signature+'\n'+code)}
  await route.fulfill({response,body})
 })
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:5189')
 await page.getByRole('button',{name:'添加',exact:true}).click()
 await page.getByRole('button',{name:'导入文件',exact:true}).click()
 await page.getByRole('button',{name:'继续审核',exact:true}).click()
 await page.getByRole('button',{name:'编辑',exact:true}).click()
 const editor=page.locator('.card-editor-page')
 await editor.getByRole('heading',{name:'编辑导入草稿',exact:true}).waitFor()
 async function source(side,text){const section=editor.locator('.card-editor-fields section').filter({has:page.getByRole('heading',{name:side,exact:false})}).first();await section.getByRole('button',{name:'源码',exact:true}).click();await section.getByRole('textbox').fill(text)}
 await source('背面','Forward edit')
 await editor.getByRole('button',{name:'反向卡',exact:true}).click();await source('背面','Reverse edit')
 await editor.getByRole('button',{name:'正向卡',exact:true}).click()
 await editor.locator('.card-editor-fields section').filter({has:page.getByRole('heading',{name:'背面',exact:true})}).getByRole('button',{name:'源码',exact:true}).click()
 assert.equal(await editor.getByRole('textbox',{name:'背面 源码'}).inputValue(),'Forward edit')
 const libraryBefore=await page.evaluate(()=>localStorage.getItem('vibe-word:cards:v1'))
 await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await editor.waitFor({state:'detached'})
 const draft=await page.evaluate(()=>window.editorFixture.jobs[0].drafts[0])
 assert.equal(draft.cards.enToCn.back,'Forward edit');assert.equal(draft.cards.cnToEn.back,'Reverse edit');assert.equal(draft.status,'ready')
 assert.equal(await page.evaluate(()=>localStorage.getItem('vibe-word:cards:v1')),libraryBefore)
 await page.getByRole('button',{name:'卡片库',exact:true}).click();await page.getByRole('button',{name:'Original front',exact:false}).click()
 await page.getByRole('button',{name:'编辑',exact:true}).click()
 await editor.getByRole('textbox',{name:'Text',exact:true}).fill('Changed text')
 await editor.getByText('Preview Changed text',{exact:true}).waitFor()
 await editor.getByRole('button',{name:'保存笔记及卡片变化',exact:true}).click();await editor.waitFor({state:'detached'})
 const saved=await page.evaluate(()=>window.editorFixture.saved)
 assert.equal(saved.expected.id,'anki');assert.equal(saved.fields.Text,'Changed text');assert.equal(saved.draft.front,'Original front')
 assert.deepEqual(errors,[]);await browser.close()
 console.log('PASS editor UI with mock native transport: import forward/reverse draft retention, save without acceptance, Anki field routing and preview')
})().catch(e=>{console.error(e);process.exit(1)})
