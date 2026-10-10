// Optional browser regression: use the same Playwright overrides as test-study-browser.cjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage({ colorScheme: 'dark', locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.THEME_TEST_URL || 'http://127.0.0.1:5299');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('vibe-word:language:v1', JSON.stringify('zh-Hans'));
      localStorage.setItem('vibe-word:cards:v1', JSON.stringify([
        { id: 'custom:theme', front: 'Theme test', back: '**Meaning**', tags: [], createdAt: Date.now() / 1000 },
      ]));
    });
    await page.reload();
    const bg = selector => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor);
    const theme = () => page.locator('html').getAttribute('data-theme');
    const button = name => page.getByRole('button', { name, exact: true });
    assert.equal(await theme(), 'light', 'Dark OS must not override default day mode');
    const light = await bg('.app-page');
    await button('开始学习').click();
    await page.locator('.study-shell').getByText('Theme test', { exact: true }).waitFor();
    assert.equal(await bg('.study-shell'), light);
    await button('‹ 返回我的卡片').click();
    for (const value of ['dark', 'light']) {
      await button('设置').click();
      await page.getByLabel('外观', { exact: true }).selectOption(value);
      assert.equal(await theme(), value);
      const background = await bg('.app-page');
      assert.equal(background === light, value === 'light');
      await button('卡片').click();
      await button('继续学习').click();
      assert.equal(await bg('.study-shell'), background);
      await page.getByRole('button', { name: /更多操作/ }).click();
      await button('编辑内容').click();
      assert.equal(await bg('.study-modal'), await bg('.study-header'));
      await page.keyboard.press('Escape');
      await button('‹ 返回我的卡片').click();
      await button('快速学习').click();
      assert.equal(await bg('.app-page'), background);
      await button('开始快速学习').click();
      assert.equal(await bg('.app-page'), background);
      await button('返回我的卡片').click();
      await button('添加').click();
      assert.equal(await bg('.app-page'), background);
      await page.reload();
      assert.equal(await theme(), value, 'Theme persists across restart');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/vibe-theme-${value}.png`, fullPage: true });
      // Start a fresh session after reload so the next iteration can resume it.
      await button('开始学习').click();
      await button('‹ 返回我的卡片').click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: default under dark OS, global day/night toggle, resume, edit modal, quick study, add, restart, mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
