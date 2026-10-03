// Dedicated simulator only; mock API credentials have no external authority.
import http from 'node:http'
import { connect } from './cdp.mjs'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4J8AAAAASUVORK5CYII='
const calls=[]
const server=http.createServer(async(req,res)=>{
  let data='';for await(const chunk of req)data+=chunk
  const body=JSON.parse(data);calls.push(req.url)
  res.setHeader('Content-Type','application/json')
  if(req.url.endsWith('/images/generations')) { res.end(JSON.stringify({data:[{b64_json:png}]}));return }
  const user=body.messages.at(-1).content
  const content=user.startsWith('Word:')?'A quiet cafe, flat illustration, soft pastel colors, centered, no text':JSON.stringify({word:'serendipity-network-test',phonetic:'/test/',definition:'网络制卡测试 <img src=x onerror="window.__attack=1">',example:'A happy discovery.',exampleTranslation:'意外的发现。',etymology:'Test origin',roots:'test roots',similar:'chance, luck',chineseHint:'网络制卡测试'})
  res.end(JSON.stringify({choices:[{message:{content}}]}))
})
await new Promise(resolve=>server.listen(8769,'0.0.0.0',resolve))
const c=await connect()
const wait=async expression=>{for(let i=0;i<150;i++){if(await c.evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out '+expression)}
try {
  await c.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`)
  await wait('document.querySelectorAll("form").length===3')
  await c.evaluate(`(() => {
    const forms=[...document.querySelectorAll('form')];
    for(const form of forms.slice(1)) {
      const values=['http://10.0.2.2:8769/v1','test-only','mock-model'];
      [...form.querySelectorAll('input')].forEach((el,i)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,values[i]);el.dispatchEvent(new Event('input',{bubbles:true}));});
    }
  })()`)
  await c.evaluate(`[...document.querySelectorAll('form')].slice(1).forEach(form=>form.requestSubmit())`)
  await wait("JSON.parse(localStorage.getItem('vibe-word:llm:v1')||'{}').model==='mock-model'")
  await c.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='添加').click()`)
  await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("AI 生成"))')
  await c.evaluate(`(() => {const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'serendipity-network-test');el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await c.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('AI 生成')).click()`)
  await wait("JSON.parse(localStorage.getItem('vibe-word:cards:v1')||'[]').filter(c=>c.front==='serendipity-network-test'||c.back==='serendipity-network-test').length===2")
  if(calls.filter(x=>x.endsWith('/chat/completions')).length!==2 || !calls.some(x=>x.endsWith('/images/generations'))) throw Error('Missing native API calls')
  console.log('PASS native HTTP, text generation, image prompt rewrite and image generation')
  await c.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='卡片').click()`)
  await wait('document.body.innerText.includes("serendipity-network-test")')
  const safe=await c.evaluate("!window.__attack && !document.querySelector('[onerror]') && !!document.querySelector('img[src^=\"data:image\"]')")
  if(!safe)throw Error('Unsafe Markdown or missing image')
  console.log('PASS rendered image and Markdown sanitization')
  // Reset mock settings through the real form; no test server configuration remains.
  await c.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`)
  await wait('document.querySelectorAll("form").length===3')
  await c.evaluate(`(() => { for(const form of [...document.querySelectorAll('form')].slice(1)){for(const el of form.querySelectorAll('input')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));}} })()`)
  await c.evaluate(`[...document.querySelectorAll('form')].slice(1).forEach(form=>form.requestSubmit())`)
  await c.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='卡片').click()`)
} finally {c.close();server.close()}
