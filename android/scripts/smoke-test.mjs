import { connect } from './cdp.mjs'
const testWord = 'serendipity · Android 测试 ' + Date.now()
const client = await connect()
const { evaluate: run, call } = client
const wait = async expression => {
  for (let i = 0; i < 80; i++) { if (await run(expression)) return; await new Promise(r => setTimeout(r, 100)) }
  throw new Error('Timed out: '+expression)
}
const click = async text => {
  await run(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b) throw Error('button missing: '+${JSON.stringify(text)}); b.click() })()`)
}
const input = async (selector, text) => {
  await run(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw Error('input missing'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`)
}
try {
  await wait('document.querySelectorAll("nav button").length===4')
  await click('添加')
  await wait('!!document.querySelector("[contenteditable=true]")')
  await input('input[placeholder="例如：serendipity"]', testWord)
  await run('document.querySelector("[contenteditable=true]").focus()')
  await call('Input.insertText', { text: '意外发现美好事物的能力。\nAndroid 模拟器功能测试卡片。' })
  await wait('document.querySelector("[contenteditable=true]").innerText.includes("意外发现")')
  await new Promise(r => setTimeout(r, 500))
  await input('input[placeholder="例如：Finding this café was pure serendipity."]', 'Finding this café was pure serendipity.')
  await click('手动添加')
  await wait('document.body.innerText.includes("已添加：")')
  await click('卡片')
  await wait(`document.body.innerText.includes(${JSON.stringify(testWord)})`)
  const result = await run(`(() => {
    const cards=JSON.parse(localStorage.getItem('vibe-word:cards:v1')||'[]');
    const card=cards.find(c=>c.front===${JSON.stringify(testWord)});
    if(!card || !card.back.includes('意外发现') || !card.example) throw Error('Manual card content not saved');
    if(!JSON.parse(localStorage.getItem('vibe-word:progress:v1')||'{}')[card.id]) throw Error('Progress not seeded');
    return {id:card.id,front:card.front,back:card.back};
  })()`)
  console.log('PASS manual add, Markdown editor, example and progress seeding', result)
  const safe = await run("JSON.parse(localStorage.getItem('vibe-word:cards:v1')||'[]').every(c=>c.front.startsWith('serendipity · Android 测试'))")
  if (!safe) throw Error('Use a dedicated test install; refusing to review non-test cards')
  await click('学习')
  await wait('!!document.querySelector("[aria-label=点击翻面]")')
  for (let n=0;n<20;n++) {
    if (await run('document.body.innerText.includes("今日学习完成")')) break
    await run('document.querySelector("[aria-label=点击翻面]").click()')
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("良好"))')
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('良好')).click()`)
    await new Promise(r=>setTimeout(r,150))
  }
  await wait('document.body.innerText.includes("今日学习完成")')
  const progress = await run(`JSON.parse(localStorage.getItem('vibe-word:progress:v1'))[${JSON.stringify(result.id)}]`)
  if(progress.repetitions!==1 || progress.interval!==1 || !progress.lastReviewedAt) throw Error('Wrong SM-2 state')
  console.log('PASS flip, grade, completion and persisted SM-2', progress)
  await click('卡片')
  await wait(`document.body.innerText.includes(${JSON.stringify(testWord)})`)
  console.log('PASS layout', await run('({width:innerWidth,scroll:document.documentElement.scrollWidth})'))
} finally { client.close() }
