const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const assert=require('node:assert/strict')
function wav(seconds=2) {
 const samples=8000*seconds, buffer=Buffer.alloc(44+samples*2)
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40)
 for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i/8000*440*Math.PI*2)*2000),44+i*2)
 return buffer
}
;(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE})
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(String(e)))
 const audio=wav(),url='data:audio/wav;base64,'+audio.toString('base64')
 const first=`<audio controls preload="none" data-label="first" src="${url}"></audio>`
 const second=`<audio controls preload='none'>\n<source src='${url}' type='audio/wav'>\n</audio>`
 const back=`Definition\n\n- Example sentence. ${first}\n\n${second}\n${first}`
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:5189')
 await page.evaluate(back=>{localStorage.clear();localStorage.setItem('vibe-word:language:v1','zh-Hans');localStorage.setItem('vibe-word:cards:v1',JSON.stringify([{id:'audio-card',front:'in good, bad, etc. nick',back,example:'Example belongs on the back.',createdAt:Date.now()/1000}]));localStorage.setItem('vibe-word:progress:v1',JSON.stringify({'audio-card':{cardId:'audio-card',ease:2.5,interval:6,repetitions:2,due:'2020-01-01',lastReviewedAt:1,phase:'review'}}))},back)
 await page.reload();await page.getByRole('button',{name:'卡片库',exact:true}).click();await page.getByRole('button',{name:'in good, bad, etc. nick',exact:false}).click()
 async function open(){await page.locator('.library-row').getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.card-editor-back .editor-audio').nth(2).waitFor()}
 const editor=page.locator('.card-editor-page'),attachments=editor.locator('.editor-audio'),rich=editor.locator('.card-editor-back .editor')
 await open()
 assert.equal(await attachments.count(),3)
 assert(!(await rich.innerText()).includes('base64'))
 async function bounds(){const result=await editor.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rows:[...el.querySelectorAll('.card-editor-pair')].map(row=>{const input=row.querySelector('.document-editor').getBoundingClientRect(),preview=row.querySelector('.card-editor-face').getBoundingClientRect();return {topDelta:Math.abs(input.top-preview.top),gap:preview.left-input.right}})}));assert(result.scroll<=result.width);for(const row of result.rows){assert(row.topDelta<1);assert(row.gap>20)}}
 await bounds();assert.equal(await editor.locator('.card-editor-back .card-editor-examples').count(),1)
 await attachments.first().locator('audio').evaluate(audio=>new Promise(resolve=>{if(Number.isFinite(audio.duration))resolve();else audio.addEventListener('loadedmetadata',resolve,{once:true})}))
 await attachments.first().getByRole('button',{name:'播放音频',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.editor-audio audio').paused)
 await attachments.first().getByRole('button',{name:'暂停播放',exact:true}).click()
 await page.screenshot({path:'design/card-editor-aligned-implemented.png',fullPage:true})
 await attachments.first().getByRole('button',{name:'查看原始标签',exact:true}).click()
 const source=editor.getByRole('textbox',{name:'背面 源码'});assert((await source.inputValue()).includes(first));assert((await source.inputValue()).includes(second));assert(await source.evaluate(el=>el.getBoundingClientRect().right<document.querySelector('.card-editor-back .card-editor-preview').getBoundingClientRect().left))
 await editor.locator('.card-editor-back .document-modes').getByRole('button',{name:'编辑',exact:true}).click();await attachments.nth(2).waitFor()
 // Real rich-text typing must preserve exact audio tags and their attributes.
 await rich.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.type('Edited ')
 const progress=await page.evaluate(()=>localStorage.getItem('vibe-word:progress:v1'))
 await editor.getByRole('button',{name:'保存修改',exact:true}).click();await editor.waitFor({state:'detached'})
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('vibe-word:cards:v1'))[0].back)
 assert(saved.includes('Edited '));assert.equal(saved.split(first).length-1,2);assert(saved.includes(second));assert.equal(await page.evaluate(()=>localStorage.getItem('vibe-word:progress:v1')),progress)
 await open()
 const replacement=wav(1)
 await attachments.first().locator('input[type=file]').setInputFiles({name:'replacement.wav',mimeType:'audio/wav',buffer:replacement})
 await page.waitForFunction(expected=>document.querySelector('.editor-audio').dataset.value.includes(expected),replacement.toString('base64'))
 await attachments.first().getByRole('button',{name:'删除附件',exact:true}).click();assert.equal(await attachments.count(),2)
 await rich.focus();await page.keyboard.press('Meta+z');await attachments.nth(2).waitFor();assert.equal(await attachments.count(),3)
 await page.keyboard.press('Meta+z');await page.waitForFunction(expected=>document.querySelector('.editor-audio').dataset.value.includes(expected),audio.toString('base64'))
 await page.setViewportSize({width:390,height:844});assert(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:'design/card-editor-audio-mobile.png',fullPage:true})
 await page.setViewportSize({width:320,height:800});assert(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth))
 await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card-editor-meta select')).backgroundColor==='rgb(41, 41, 44)');await bounds();await page.screenshot({path:'design/card-editor-aligned-dark-implemented.png',fullPage:true})
 assert.deepEqual(errors,[]);await browser.close()
 console.log('PASS aligned editor: rich-text long Base64, simultaneous front/back alignment, inline/multiline/source audio, real playback, exact tag persistence, replace/delete/undo, progress retention, 390px/320px, dark theme')
})().catch(e=>{console.error(e);process.exit(1)})
