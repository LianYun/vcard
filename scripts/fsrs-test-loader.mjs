import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as upstream from 'ts-fsrs'
function load(file,deps={}) {
 const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,Math,crypto,require:n=>deps[n]})
 return module.exports
}
export const fsrsTestDependency=load('src/lib/fsrs.ts',{'ts-fsrs':upstream,'./date':load('src/lib/date.ts')})
