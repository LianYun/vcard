const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    const errors = []; page.on('pageerror', error => errors.push(String(error)))
    await page.goto(process.env.STUDY_TEST_URL || 'http://127.0.0.1:5198')
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('vibe-word:language:v1', JSON.stringify('zh-Hans'))
      localStorage.setItem('vibe-word:cards:v1', JSON.stringify([
        { id: 'a-x', front: 'a-x', back: 'answer', deckId: 'a', tags: ['x'] },
        { id: 'a-y', front: 'a-y', back: 'answer', deckId: 'a', tags: ['y'] },
        { id: 'b-x', front: 'b-x', back: 'answer', deckId: 'b', tags: ['x'] },
        { id: 'b-y', front: 'b-y', back: 'answer', deckId: 'b', tags: ['y'] },
      ]))
      localStorage.setItem('vibe-word:decks:v1', JSON.stringify([{ id: 'default', name: '默认牌组' }, { id: 'a', name: '商务英语' }, { id: 'b', name: '日常英语' }]))
    })
    await page.reload()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('自定义范围', { exact: true }).check()
    const rule = index => page.getByRole('region', { name: `范围 ${index}`, exact: true })
    async function choose(index, deck, tag) {
      await rule(index).getByRole('button', { name: '选择牌组', exact: true }).click()
      let dialog = page.getByRole('dialog', { name: '选择牌组', exact: true })
      await dialog.getByLabel(deck, { exact: true }).check()
      await dialog.getByRole('button', { name: '完成', exact: true }).click()
      await rule(index).getByRole('button', { name: '选择标签', exact: true }).click()
      dialog = page.getByRole('dialog', { name: '选择标签', exact: true })
      await dialog.getByRole('checkbox', { name: new RegExp(`^${tag}`) }).check()
      await dialog.getByRole('button', { name: '完成', exact: true }).click()
    }
    await choose(1, '商务英语', 'x')
    await page.getByRole('button', { name: '＋ 添加学习范围', exact: true }).click()
    await choose(2, '日常英语', 'y')
    await page.getByText('合计匹配 2 张卡片，已去重', { exact: true }).waitFor()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.getByRole('button', { name: '已保存', exact: true }).waitFor()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vibe-word:settings:v1')))
    assert.equal(saved.studyScope.rules.length, 2)
    await page.reload()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByText('合计匹配 2 张卡片，已去重', { exact: true }).waitFor()
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await rule(1).getByRole('button', { name: '选择牌组', exact: true }).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.getByRole('dialog', { name: '选择牌组' }).getByRole('button', { name: '完成' }).click()
    }
    await page.screenshot({ path: '/tmp/vibe-composite-scope-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.getByRole('button', { name: '今日练习', exact: true }).click()
    await page.getByRole('button', { name: '开始学习', exact: true }).click()
    await page.waitForFunction(() => {
      const progress = (JSON.parse(localStorage.getItem('vibe-word:study:v3') || '{}').progress || {})
      return Object.values(progress).filter(item => item.issuedAt).length === 2
    })
    const issued = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('vibe-word:study:v3')).progress).filter(item => item.issuedAt).map(item => item.cardId).sort())
    assert.deepEqual(issued, ['a-x', 'b-y'])
    assert.deepEqual(errors, [])
    console.log('PASS composite scope browser: independent selections, counts, save/reload, 390/320px bottom sheet, no overflow or runtime errors')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
