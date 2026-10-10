// Development-only UI fixture. The native parser/commit are tested separately by test-anki.sh.
import React from 'react'
import { createRoot } from 'react-dom/client'
import fixture from './preview.json'
import '../../../src/index.css'
import '../../../src/theme.css'
const summary = {stage:'fixture',name:'English · Anki 兼容性样本',count:fixture.cards.length,decks:fixture.decks,warnings:fixture.warnings,mediaCount:fixture.mediaCount}
Object.assign(window, {__TAURI_INTERNALS__: {invoke: async (command: string, args: any) => {
  if(command==='native_cloud_storage')return true
  if(command==='inspect_anki')return summary
  if(command==='cloud_storage'){
    switch(args.command){
      case 'decks':return [{id:'default',name:'默认牌组'}]
      case 'pendingAnki':return []
      case 'ankiPage':return fixture.cards
      case 'ankiModels':return []
      case 'ankiMedia':return `data:${args.args.id.endsWith('.wav')?'audio/wav':'image/png'};base64,${(fixture.media as Record<string,string>)[args.args.id]}`
      case 'commitAnki':return {added:3,skipped:0,next:3,total:3,done:true}
      case 'discardAnki':return null
    }
  }
  throw new Error(command)
}}})
const {AnkiImport}=await import('../../../src/components/AnkiImport')
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:900,margin:'24px auto',padding:16}}><AnkiImport onChanged={()=>{}}/></main>)
