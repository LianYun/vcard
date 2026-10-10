import { useEffect, useRef, useState } from 'react'
import { cancelAnki, ankiModels, pendingAnki, remapAnki, type AnkiModel, ankiPage, commitAnki, discardAnki, inspectAnki, loadDecks, supportsDocumentImport, type AnkiPreview } from '../lib/storage'
import type { Card, Deck } from '../types'
import { deckPath } from '../lib/decks'
import { Markdown } from './Markdown'
import { t } from '../lib/i18n'
export function AnkiImport({ onChanged }: { onChanged: () => void }) {
  const [supported,setSupported]=useState(false),[preview,setPreview]=useState<AnkiPreview|null>(null),[cards,setCards]=useState<Card[]>([])
  const [decks,setDecks]=useState<Deck[]>([]),[selection,setSelection]=useState<string[]>([]),[parent,setParent]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(0)
  const [pending,setPending]=useState<AnkiPreview[]>([]),[models,setModels]=useState<AnkiModel[]>([]),[mappings,setMappings]=useState<Record<string,{front:string;back:string}>>({})
  useEffect(()=>{void pendingAnki().then(setPending).catch(e=>setError(String(e)))},[])
  useEffect(()=>{if(preview)void ankiModels(preview.stage).then(setModels).catch(e=>setError(String(e)))},[preview?.stage])
  const cancelled=useRef(false),offset=useRef(0),totals=useRef({added:0,skipped:0})
  useEffect(()=>{void supportsDocumentImport().then(setSupported).catch(e=>setError(String(e)));void loadDecks().then(setDecks).catch(e=>setError(String(e)))},[])
  useEffect(()=>{let active=true;if(preview)void ankiPage(preview.stage,page*20).then(c=>{if(active)setCards(c)}).catch(e=>setError(String(e)));return()=>{active=false}},[preview,page])
  async function choose(){setBusy(true);setError('');setStatus(t('正在解析牌组和附件…'));try{const next=await inspectAnki();if(next){setMappings({});setPreview(next);setSelection(next.decks.filter(d=>!d.parentId).map(d=>d.id));setPage(0);offset.current=0;totals.current={added:0,skipped:0}}setStatus('')}catch(e){setError(String(e));setStatus('')}finally{setBusy(false)}}
  async function save(){if(!preview)return;setBusy(true);setError('');cancelled.current=false
    try{while(!cancelled.current){const r=await commitAnki(preview.stage,offset.current,selection,parent||undefined);offset.current=r.next;totals.current.added+=r.added;totals.current.skipped+=r.skipped;setStatus(`${r.next} / ${r.total} · ${t('新增')} ${totals.current.added} · ${t('重复跳过')} ${totals.current.skipped}`);onChanged();if(r.done){await discardAnki(preview.stage);setPending(pending.filter(p=>p.stage!==preview.stage));setPreview(null);setCards([]);break}}}catch(e){setError(String(e))}finally{setBusy(false)}}
  return <section className="app-surface space-y-4 p-5"><h2 className="text-xl font-semibold">{t('导入 Anki')}</h2>
    <p>{t('选择从 AnkiWeb 下载的 .apkg，保留牌组、Cloze、图片和音频。学习进度从新卡开始。')}</p>
    {!supported?<p>{t('请在 Mac 应用中导入；导入结果可同步到手机。')}</p>:<button className="btn-primary" disabled={busy||!!preview} onClick={()=>void choose()}>{t('选择 .apkg 文件')}</button>}
    {busy&&!preview&&<button className="btn-secondary" onClick={()=>void cancelAnki().catch(e=>setError(String(e)))}>{t('取消解析')}</button>}
    {!preview&&pending.length>0&&<div><h3>{t('未完成的导入')}</h3>{pending.map(item=><button key={item.stage} className="btn-secondary" onClick={()=>{setPreview(item);setSelection(item.decks.filter(d=>!d.parentId).map(d=>d.id));offset.current=0;totals.current={added:0,skipped:0}}}>{item.name} · {item.count}</button>)}</div>}
    {error&&<p role="alert" className="text-red-600">{error}</p>}{status&&<p role="status">{status}</p>}
    {preview&&<><h3>{preview.name} · {preview.count} {t('张卡片')} · {preview.mediaCount} {t('个附件')}</h3>
      <fieldset disabled={busy||offset.current>0} className="space-y-2"><legend>{t('选择牌组（包含子牌组）')}</legend>{preview.decks.map(d=><label className="block" key={d.id}><input type="checkbox" checked={selection.includes(d.id)} onChange={e=>setSelection(e.target.checked?[...selection,d.id]:selection.filter(id=>id!==d.id))}/> {deckPath(d.id,preview.decks)}</label>)}
        <label>{t('挂到现有牌组下')}<select className="input" value={parent} onChange={e=>setParent(e.target.value)}><option value="">{t('顶层')}</option>{decks.map(d=><option key={d.id} value={d.id}>{deckPath(d.id,decks)}</option>)}</select></label>
        <p className="text-sm">{t('已导入的来源卡片会跳过，保留本地修改和学习进度。已有来源牌组沿用当前层级。')}</p>
      </fieldset>
      {models.some(m=>!m.cloze)&&<details><summary>{t('自定义字段映射')}</summary><p>{t('仅在模板无法正确转换时使用；同一笔记类型的卡片将使用指定正反面。')}</p>
        {models.filter(m=>!m.cloze).map(model=><fieldset key={model.id} disabled={busy||offset.current>0}><legend>{model.name}</legend>
          <label><input type="checkbox" checked={!!mappings[model.id]} onChange={e=>{const next={...mappings};if(e.target.checked)next[model.id]={front:model.fields[0],back:model.fields[1]??model.fields[0]};else delete next[model.id];setMappings(next)}}/>{t('指定字段')}</label>
          {mappings[model.id]&&(['front','back'] as const).map(side=><label key={side}>{t(side==='front'?'正面':'背面')}<select className="input" value={mappings[model.id][side]} onChange={e=>setMappings({...mappings,[model.id]:{...mappings[model.id],[side]:e.target.value}})}>{model.fields.map(f=><option key={f}>{f}</option>)}</select></label>)}
        </fieldset>)}
        <button className="btn-secondary" disabled={busy||offset.current>0} onClick={async()=>{setBusy(true);try{setPreview(await remapAnki(preview.stage,mappings));setPage(0)}catch(e){setError(String(e))}finally{setBusy(false)}}}>{t('重新生成预览')}</button>
      </details>}
      {!!preview.warnings.length&&<details><summary>{t('兼容性提示')} ({preview.warnings.length})</summary><ul className="max-h-52 overflow-auto">{preview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
      <div className="max-h-[32rem] space-y-4 overflow-auto">{cards.map(c=><article className="rounded-xl border p-4" key={c.id}><p className="text-xs text-slate-500">{deckPath(c.deckId??'default',preview.decks)} {c.anki?.cloze?'· Cloze':''}</p><Markdown content={c.front} stage={preview.stage}/><hr className="my-3"/><Markdown content={c.back} stage={preview.stage}/></article>)}</div>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={!page} onClick={()=>setPage(page-1)}>{t('上一页')}</button><span>{page+1} / {Math.max(1,Math.ceil(preview.count/20))}</span><button className="btn-secondary" disabled={(page+1)*20>=preview.count} onClick={()=>setPage(page+1)}>{t('下一页')}</button></div>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={busy||!selection.length||!preview.count} onClick={()=>void save()}>{offset.current?t('继续导入'):t('确认导入')}</button>{busy&&<button className="btn-secondary" onClick={()=>{cancelled.current=true}}>{t('完成当前批次后暂停')}</button>}
      <button className="btn-secondary" disabled={busy} onClick={async()=>{try{await discardAnki(preview.stage);setPending(pending.filter(p=>p.stage!==preview.stage));setPreview(null);setCards([])}catch(e){setError(String(e))}}}>{t('关闭预览')}</button></div>
    </>}
  </section>
}
