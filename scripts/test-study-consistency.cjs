const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      Math.random = () => .999999;
      const realNow = Date.now;
      let offset = 0;
      Date.now = () => realNow() + offset;
      window.advanceStudyTime = () => { offset += 120000; };
    });
    await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5193');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('vibe-word:language:v1', 'zh-Hans');
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const cards = ['waiting', 'reading', 'sibling', 'other', 'new', 'new-sibling', 'limited'].map(id => ({
        id, front: id, back: `Answer ${id}`, deckId: 'default',
        noteId: ['reading','sibling'].includes(id) ? 'old-pair' : ['new','new-sibling'].includes(id) ? 'new-pair' : undefined,
      }));
      const progress = Object.fromEntries(cards.slice(0,4).map(card => [card.id, {
        cardId: card.id, ease: 2.5, interval: 6, repetitions: 2, due: day,
        lastReviewedAt: Date.now()-86400000, phase: card.id === 'waiting' ? 'relearning' : 'review',
        learningDue: card.id === 'waiting' ? Date.now()+60000 : null,
      }]));
      localStorage.setItem('vibe-word:cards:v1', JSON.stringify(cards));
      localStorage.setItem('vibe-word:study:v3', JSON.stringify({ progress, controls: {}, reviews: [], issued: {} }));
      localStorage.setItem('vibe-word:settings:v1', JSON.stringify({ newCardsPerDay: 10 }));
      localStorage.setItem('vibe-word:decks:v1', JSON.stringify([{ id: 'default', name: '默认牌组', newCardsPerDay: 1 }]));
    });
    await page.reload();
    const counts = () => page.locator('.mac-stats .text-2xl').allTextContents();
    await page.waitForFunction(() => document.querySelector('.mac-stats')?.textContent.includes('今日待复习'));
    assert.deepEqual(await counts(), ['4','1','7'], 'Home includes waiting learning and respects deck and sibling limits');
    await page.getByRole('button', {name: '开始学习', exact: true}).first().click();
    await page.getByText('reading', {exact: true}).filter({visible:true}).waitFor();
    assert.equal(await page.locator('.study-progress span').innerText(), '已完成 0 · 剩余 5');
    await page.locator('.study-card').click();
    const revealed = await page.locator('.study-card').innerText();
    await page.evaluate(() => window.advanceStudyTime());
    await page.waitForTimeout(1300);
    assert.equal(await page.locator('.study-card').innerText(), revealed, 'A timer must not replace or flip the displayed card');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.study-card').innerText(), revealed, 'A refresh must preserve the displayed answer');
    await page.locator('.study-grade.easy').click();
    await page.getByText('waiting', {exact:true}).filter({visible:true}).waitFor();
    assert.equal(await page.locator('.study-progress span').innerText(), '已完成 1 · 剩余 3', 'Sibling burial reduces remaining immediately');
    assert.equal(await page.locator('.study-progress progress').getAttribute('max'), '4');
    await page.getByRole('button', {name:'‹ 返回',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.mac-stats .text-2xl')?.textContent === '3');
    assert.deepEqual(await counts(), ['3','0','7'], 'Home total equals actual session remainder');
    await page.getByRole('button', {name:/继续上次学习/}).click();
    await page.getByRole('button', {name:'更多操作',exact:true}).click();
    await page.getByRole('button', {name:'撤销评分',exact:true}).click();
    await page.getByText('reading', {exact:true}).filter({visible:true}).waitFor();
    assert.equal(await page.locator('.study-progress span').innerText(), '已完成 0 · 剩余 5');
    // Simulate a sync: one queued card was completed elsewhere.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('vibe-word:study:v3'));
      data.progress.other.due = '2099-01-01';
      localStorage.setItem('vibe-word:study:v3',JSON.stringify(data));
      window.dispatchEvent(new Event('vibe-library-changed'));
    });
    await page.getByText('已完成 0 · 剩余 4', {exact:true}).waitFor();
    // A newly due card joins the remainder without replacing the current card.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('vibe-word:study:v3'));
      data.progress.limited = {...data.progress.other, cardId:'limited', due:'2020-01-01'};
      localStorage.setItem('vibe-word:study:v3',JSON.stringify(data));
      window.dispatchEvent(new Event('vibe-library-changed'));
    });
    await page.getByText('已完成 0 · 剩余 5', {exact:true}).waitFor();
    assert.equal(await page.locator('.study-progress span').innerText(), '已完成 0 · 剩余 5');
    await page.getByText('reading', {exact:true}).filter({visible:true}).waitFor();
    await page.getByRole('button', {name:'更多操作',exact:true}).click();
    await page.getByRole('button', {name:'今天跳过',exact:true}).click();
    assert.equal(await page.locator('.study-progress span').innerText(), '已完成 0 · 剩余 4');
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const header = await page.locator('.study-header').boundingBox();
    const label = await page.locator('.study-progress span').boundingBox();
    assert(label.x >= header.x && label.x+label.width <= header.x+header.width);
    await page.screenshot({path:'/tmp/study-consistency-mobile.png'});
    assert.deepEqual(errors, []);
    console.log('PASS matching home/session counts, learning timer and refresh pinning, next-card priority, sibling burial, undo, sync reconciliation, skip and mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
