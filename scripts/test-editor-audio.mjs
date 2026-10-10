import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

const module = { exports: {} }
const code = ts.transpileModule(fs.readFileSync('src/lib/editorAudio.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, { module, exports: module.exports, require(name) {
  if (name.endsWith('/utils')) return { $remark: () => [], $view: () => null }
  if (name.endsWith('/commonmark')) return { htmlSchema: { node: {} } }
  return {}
} })
const { mergeAudioNodes } = module.exports
const first = '<audio controls preload="none" src="data:audio/wav;base64,AAA"></audio>'
const second = "<audio controls>\n<source src='data:audio/wav;base64,BBB' type='audio/wav'>\n</audio>"
function htmlNodes(node) { return [...(node.type === 'html' ? [node.value] : []), ...(node.children ?? []).flatMap(htmlNodes)] }
for (const wrap of [false, true]) {
  const source = `Definition\n\n- Sentence ${first}\n\n${second}\n${first}`
  const tree = unified().use(remarkParse).parse(source)
  if (wrap) tree.children = tree.children.map(child => child.type === 'html' ? { type: 'paragraph', children: [child] } : child)
  mergeAudioNodes(tree, source)
  assert.deepEqual(htmlNodes(tree), [first, second, first])
  const check = node => { if (node.type === 'paragraph') assert(!node.children.some(child => child.type === 'paragraph')); node.children?.forEach(check) }
  check(tree)
}
for (const source of ['`'+first+'`', '```html\n'+first+'\n```', '<audio src="data:audio/wav;base64,AAA">', '<div>HTML content</div>']) {
  const tree = unified().use(remarkParse).parse(source), before = JSON.stringify(tree)
  mergeAudioNodes(tree, source)
  assert.equal(JSON.stringify(tree), before, 'Code samples, incomplete elements and unrelated HTML remain untouched')
}
console.log('PASS audio AST: inline/list audio, multiline sources, adjacent audio blocks, exact HTML bytes, no nested paragraphs, code/malformed/unrelated HTML preservation')
