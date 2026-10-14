import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
// Isolated editor with a controllable native response; never touches the user's library.
const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CardEditorProvider, useCardEditor } from '/src/components/CardEditor.tsx'
import '/src/index.css'
const card = { id: 'fixture', front: 'Cached front', back: 'Answer', tags: [], deckId: 'default' }
window.fixtureCard = card
function Launcher() {
 const open = useCardEditor()
 return React.createElement('button', { onClick: () => open({ kind: 'card', id: card.id, ...(window.noCache ? {} : { card }) }) }, 'Open fixture')
}
createRoot(document.getElementById('root')).render(React.createElement(CardEditorProvider, null, React.createElement(Launcher)))
`
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
 name: 'card-editor-fixture',
 resolveId(id) { if (id === '/editor-fixture.js') return '\0editor-fixture' },
 load(id) { if (id === '\0editor-fixture') return fixture },
 configureServer(server) { server.middlewares.use('/__editor_test__', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(await server.transformIndexHtml('/__editor_test__', '<div id="root"></div><script type="module" src="/editor-fixture.js"></script>'))
 }) },
}] })
let browser
try {
 await server.listen()
 browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE })
 const page = await browser.newPage()
 const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error(error) })
 await page.addInitScript(() => {
  localStorage.setItem('vibe-word:language:v1', 'zh-Hans')
  window.calls = []; window.pending = []
  window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
   if (command === 'native_cloud_storage') return true
   if (command !== 'cloud_storage') throw new Error('Unexpected command: ' + command)
   window.calls.push(args)
   if (args.command === 'card') return new Promise((resolve, reject) => window.pending.push({ resolve, reject }))
   if (args.command === 'decks') return [{ id: 'default', name: '默认牌组' }]
   if (args.command === 'saveEditedCard') return null
   throw new Error('Unexpected storage read: ' + args.command)
  } }
 })
 const url = `http://127.0.0.1:${server.httpServer.address().port}/__editor_test__`
 const open = async () => { await page.goto(url); await page.getByRole('button', { name: 'Open fixture' }).click() }
 const editor = page.locator('.card-editor-page')
 const front = () => editor.getByRole('textbox', { name: '正面', exact: true })
 const save = () => editor.getByRole('button', { name: '保存修改', exact: true })
 const resolve = async mode => page.evaluate(mode => {
  const current = mode === 'deleted' ? null : { ...window.fixtureCard, ...(mode === 'changed' ? { front: 'Remote update' } : {}) }
  window.pending.shift().resolve(current)
 }, mode)
 await open()
 await front().waitFor()
 assert.equal(await front().innerText(), 'Cached front', 'Content appears before native read resolves')
 assert.equal(await save().isDisabled(), true)
 await front().fill('User edit during lookup')
 await resolve('same')
 await page.waitForFunction(() => !document.querySelector('.card-editor-header .btn-primary').disabled)
 assert.equal(await front().innerText(), 'User edit during lookup')
 await save().click()
 assert.equal(await page.evaluate(() => window.calls.find(c => c.command === 'saveEditedCard').args.draft.front.trim()), 'User edit during lookup')
 assert.equal(await page.evaluate(() => window.calls.some(c => c.command === 'cards')), false)
 // A newer remote value can populate an untouched editor.
 await open(); await front().waitFor(); await resolve('changed')
 await page.waitForFunction(() => document.querySelector('[aria-label="正面"]')?.textContent === 'Remote update')
 // But a late remote value must never replace an in-flight user edit.
 await open(); await front().waitFor(); await front().fill('Keep my draft'); await resolve('changed')
 await editor.getByRole('alert').waitFor()
 assert.equal(await front().innerText(), 'Keep my draft'); assert.equal(await save().isDisabled(), true)
 await open(); await front().waitFor(); await resolve('deleted'); await editor.getByRole('alert').waitFor()
 assert.equal(await save().isDisabled(), true)
 await open(); await front().waitFor()
 await page.evaluate(() => window.pending.shift().reject(new Error('Storage unavailable')))
 await editor.getByRole('alert').waitFor(); assert.equal(await save().isDisabled(), true)
 // ID-only callers still work and wait for their one-card response.
 await page.goto(url); await page.evaluate(() => { window.noCache = true })
 await page.getByRole('button', { name: 'Open fixture' }).click()
 await editor.getByRole('status').waitFor(); await resolve('same'); await front().waitFor()
 assert.equal(await front().innerText(), 'Cached front')
 assert.deepEqual(errors, [])
 console.log('PASS: instant cached edit, single-card lookup, preserved typing, fresh data, conflict/deletion/read failure guards, ID-only fallback')
} finally { await browser?.close(); await server.close() }
