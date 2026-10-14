// Isolated browser regression: opening either picker must reuse the ready snapshot.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5193')
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('vibe-word:language:v1', JSON.stringify('zh-Hans'))
      localStorage.setItem('vibe-word:cards:v1', JSON.stringify([
        { id: 'a', front: 'Alpha', back: 'Answer', tags: ['work'], deckId: 'parent' },
        { id: 'b', front: 'Beta', back: 'Answer', tags: ['work'], deckId: 'child' },
        { id: 'c', front: 'Gamma', back: 'Answer', tags: ['travel'], deckId: 'default' },
      ]))
      localStorage.setItem('vibe-word:decks:v1', JSON.stringify([
        { id: 'default', name: '默认牌组' }, { id: 'parent', name: 'Parent', newCardsPerDay: 1 },
        { id: 'child', name: 'Child', parentId: 'parent' },
      ]))
    })
    await page.reload()
    const button = name => page.getByRole('button', { name, exact: true })
    await button('按标签学习').waitFor()
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '按标签学习')?.disabled)
    // Allow the initial background history prefetch to finish before counting navigation reads.
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      const original = Storage.prototype.getItem
      window.pickerReads = []
      Storage.prototype.getItem = function(key) {
        if (/^vibe-word:(cards|study|progress|settings|meta|decks):/.test(key)) window.pickerReads.push(key)
        return original.call(this, key)
      }
    })
    for (const name of ['按标签学习', '按牌组学习']) {
      await page.evaluate(() => { window.pickerReads = [] })
      await button(name).click()
      const picker = page.locator('.tag-study-page')
      await picker.locator('.app-surface').waitFor()
      assert.equal(await picker.getByText('准备中…', { exact: true }).count(), 0)
      if (name === '按标签学习') await picker.getByRole('checkbox', { name: /work/ }).check()
      else {
        await picker.getByRole('combobox', { name: '牌组', exact: true }).click()
        await page.getByRole('option', { name: 'Parent', exact: true }).click()
        await picker.getByText('包含 2 张卡片', { exact: true }).waitFor()
      }
      await picker.getByText('本次可学：待复习 0 张 · 新卡 1 张', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.pickerReads), [], `${name} must not reload storage`)
      await button('‹ 返回我的卡片').click()
    }
    await button('按牌组学习').click()
    await button('开始学习 · 1 张').click()
    await page.locator('.study-card').waitFor()
    await page.locator('.study-header').getByRole('button', { name: '‹ 返回', exact: true }).click()
    await page.locator('.tag-study-page').getByText('本次可学：待复习 1 张 · 新卡 0 张', { exact: true }).waitFor()
    // Changes while a picker is open must still flow through the shared snapshot.
    await page.evaluate(() => {
      const cards = JSON.parse(localStorage.getItem('vibe-word:cards:v1'))
      cards.push({ id: 'd', front: 'Delta', back: 'Answer', tags: ['work'], deckId: 'child' })
      localStorage.setItem('vibe-word:cards:v1', JSON.stringify(cards))
      window.dispatchEvent(new Event('vibe-library-changed'))
    })
    await page.locator('.tag-study-page').getByText('包含 3 张卡片', { exact: true }).waitFor()
    await button('＋ 新建牌组').click()
    await page.locator('dialog[open]').getByRole('textbox', { name: '名称', exact: true }).fill('New deck')
    await page.locator('dialog[open]').getByRole('button', { name: '保存', exact: true }).click()
    await page.locator('.tag-study-page').getByRole('combobox', { name: '牌组', exact: true }).filter({ hasText: 'New deck' }).waitFor()
    await button('开始学习 · 0 张').waitFor()
    assert.equal(await button('开始学习 · 0 张').isDisabled(), true)
    assert.deepEqual(errors, [])
    console.log('PASS both pickers: zero navigation storage reads, tag/deck counts and limits, child decks, session return, live updates, inline deck creation')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
