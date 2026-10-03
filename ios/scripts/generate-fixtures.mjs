// Execute the existing TypeScript algorithms, rather than duplicating their formulas.
import ts from 'typescript'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Math,
    require: p => load(path.resolve(path.dirname(file), p + '.ts')) })
  cache.set(file, module.exports)
  return module.exports
}
const { grade, initialState } = load(path.join(root, 'src/lib/sm2.ts'))
const { cardsToObsidianMd } = load(path.join(root, 'src/lib/export.ts'))
const fixtures = []
for (const repetitions of [0, 1, 2, 8]) for (const ease of [1.3, 2.5, 2.65])
for (const interval of [0, 1, 6, 13]) for (const quality of [1, 3, 4, 5]) {
 const previous = { ...initialState('test', '2026-09-30'), repetitions, ease, interval }
 const next = grade(previous, quality, '2026-09-30'); next.lastReviewedAt = 123456
 fixtures.push({ previous, quality, next })
}
const llm = fs.readFileSync(path.join(root, 'src/lib/llm.ts'), 'utf8')
const cardsPrompt = llm.match(/const SYSTEM_PROMPT = `([\s\S]*?)`/)[1]
const imagePrompt = llm.match(/const IMAGE_REWRITE_PROMPT = `([\s\S]*?)`/)[1]
const cards = [{id:'custom:test',front:'word\n\nfront',back:'line\r\n\r\n**bold**\n\n\nend',example:'an\n\nexample'}]
fs.writeFileSync(path.join(root,'ios/Tests/VibeWordCoreTests/Fixtures/parity.json'), JSON.stringify({ cardsPrompt, imagePrompt, grades: fixtures, cards, markdown: cardsToObsidianMd(cards) }, null, 2)+'\n')
console.log(`Generated ${fixtures.length} SM-2 cases and Obsidian export fixture from TypeScript`)
