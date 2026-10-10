import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DEFAULT_SCHEDULER, elapsedDays, rescheduleProjection, validateConfig } from '../lib/fsrs'
import { loadSchedulerConfig, loadStudyData, rescheduleAll, saveSchedulerConfig } from '../lib/storage'
import { addDays, todayKey } from '../lib/date'
import type { OptimizationResult, SchedulerConfig, StudyData } from '../types'
import { localizedMessage, t } from '../lib/i18n'

export interface SchedulerSettingsHandle { save: () => Promise<boolean> }
export const SchedulerSettings = forwardRef<SchedulerSettingsHandle, {onDirty:(dirty:boolean)=>void}>(function SchedulerSettings({onDirty}, ref) {
  const [config,setConfig]=useState<SchedulerConfig>(structuredClone(DEFAULT_SCHEDULER))
  const [baseline,setBaseline]=useState(config)
  const [data,setData]=useState<StudyData|null>(null)
  const [learning,setLearning]=useState('1 10'),[relearning,setRelearning]=useState('10')
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0)
  const [message,setMessage]=useState(''),[error,setError]=useState('')
  const [result,setResult]=useState<OptimizationResult|null>(null),[confirm,setConfirm]=useState(false)
  const worker=useRef<Worker|null>(null)
  async function reload() {
    const [c,d]=await Promise.all([loadSchedulerConfig(),loadStudyData()])
    setConfig(c);setBaseline(c);setLearning(c.learningSteps.join(' '));setRelearning(c.relearningSteps.join(' '));setData(d)
  }
  useEffect(()=>{void reload().catch(e=>setError(String(e)));return()=>worker.current?.terminate()},[])
  const states=useMemo(()=>Object.values(data?.progress??{}).filter(s=>!data?.controls[s.cardId]?.suspended),[data])
  const projection=useMemo(()=>rescheduleProjection(states,data?.reviews??[],config),[states,data,config])
  const end=addDays(todayKey(),7)
  const before=states.filter(s=>s.lastReviewedAt!=null&&s.learningDue==null&&s.due<=end).length
  const after=projection.filter(s=>s.due<=end).length
  const eligible=(data?.reviews??[]).filter(r=>!r.undone&&r.before.lastReviewedAt!=null&&elapsedDays(r.before.lastReviewedAt,r.timestamp)>0)
  const ready=eligible.length>=200&&eligible.filter(r=>r.quality<3).length>=20&&eligible.filter(r=>r.quality>=3).length>=20
  const dirty=JSON.stringify(config)!==JSON.stringify(baseline)||learning!==baseline.learningSteps.join(' ')||relearning!==baseline.relearningSteps.join(' ')
  useEffect(()=>{onDirty(dirty)},[dirty,onDirty])
  useImperativeHandle(ref,()=>({save:()=>dirty?save():Promise.resolve(true)}))
  async function save(candidate?:SchedulerConfig):Promise<boolean> {
    setBusy(true);setError('');setMessage('')
    try {
      const next=validateConfig({...candidate??config,id:crypto.randomUUID(),learningSteps:learning.trim().split(/[\s,，]+/).map(Number),relearningSteps:relearning.trim().split(/[\s,，]+/).map(Number)})
      await saveSchedulerConfig(next,baseline.id);await reload();setResult(null);setMessage(t('已应用，下一次评分开始使用；现有到期日保持不变。'));return true
    }catch(e){setError(String(e));return false}finally{setBusy(false)}
  }
  function optimize() {
    setBusy(true);setProgress(0);setError('');setResult(null)
    const w=new Worker(new URL('../lib/fsrs.worker.ts',import.meta.url),{type:'module'});worker.current=w
    w.onmessage=({data:reply})=>{
      if(reply.progress!=null)setProgress(reply.progress)
      else {w.terminate();worker.current=null;setBusy(false);if(reply.error)setError(reply.error);else setResult(reply.result)}
    }
    w.onerror=e=>{setError(e.message);w.terminate();worker.current=null;setBusy(false)}
    w.postMessage({history:data?.reviews??[],config:baseline})
  }
  return <section className="app-surface fsrs-settings" aria-label={t('智能复习')}>
    <div className="fsrs-heading"><div><span className="fsrs-badge">FSRS-6</span><h3>{t('让复习适合你的记忆')}</h3><p>{t('根据每次回忆的难易和间隔，安排下一次见面。')}</p></div><span className="fsrs-chip">{baseline.optimizedAt?t('个人参数'):t('默认参数')}</span></div>
    {error&&<p role="alert" className="text-red-600">{localizedMessage(error)}</p>}
    {message&&<p role="status" className="status-success">{message}</p>}
    <fieldset disabled={busy||!data}>
      <div className="fsrs-retention"><label htmlFor="fsrs-retention">{t('目标记忆保持率')}<strong>{Math.round(config.retention*100)}%</strong></label><input id="fsrs-retention" type="range" min="70" max="97" step="1" value={Math.round(config.retention*100)} onChange={e=>setConfig({...config,retention:Number(e.target.value)/100})}/><p>{t('90% 是均衡起点。提高保持率会缩短间隔，增加复习次数。')}</p></div>
      <div className="fsrs-forecast"><div><small>{t('未来 7 天已安排')}</small><strong>{before}<span>{t('张')}</span></strong></div><span aria-hidden="true">→</span><div><small>{t('按当前保持率重排')}</small><strong>{after}<span>{t('张')}</span></strong></div><p>{t('仅估算已学卡片的下一次到期，包含逾期；不预测之后的重复评分。')}</p></div>
      <details><summary>{t('学习步骤与间隔')}</summary><div className="fsrs-fields"><label>{t('新卡步骤（分钟）')}<input className="app-field" value={learning} onChange={e=>setLearning(e.target.value)} placeholder="1 10"/></label><label>{t('重学步骤（分钟）')}<input className="app-field" value={relearning} onChange={e=>setRelearning(e.target.value)} placeholder="10"/></label><label>{t('最大间隔（天）')}<input className="app-field" type="number" min="1" max="36500" value={config.maximumInterval} onChange={e=>setConfig({...config,maximumInterval:Number(e.target.value)})}/></label></div><p>{t('用空格分隔递增的分钟数。困难表示费力想起；忘记请选重来。')}</p></details>
      <div className="fsrs-actions"><button className="btn-primary" disabled={!dirty} onClick={()=>void save()}>{t('应用复习设置')}</button><button className="btn-secondary" onClick={()=>{setConfig(structuredClone(DEFAULT_SCHEDULER));setLearning('1 10');setRelearning('10');setResult(null)}}>{t('恢复默认参数')}</button></div>
    </fieldset>
    <div className="fsrs-personal"><h4>{t('根据我的记录优化')}</h4><p>{t('在本机训练，使用较晚的记录独立验证；改善后再应用。')}</p><p>{t('跨日复习 {0} 次 · 遗忘 {1} 次',eligible.length,eligible.filter(r=>r.quality<3).length)}</p><button className="btn-secondary" disabled={busy||!ready||dirty} onClick={optimize}>{t('优化个人参数')}</button>{!ready&&<small>{t('需要至少 200 次跨日复习，其中至少 20 次遗忘和 20 次记住')}</small>}
      {worker.current&&<div role="status"><progress value={progress} max="1"/><span>{Math.round(progress*100)}%</span><button className="study-quiet" onClick={()=>{worker.current?.terminate();worker.current=null;setBusy(false)}}>{t('取消')}</button></div>}
      {result&&<div className="fsrs-result" role="status"><strong>{result.accepted?t('找到更适合你的参数'):t('当前参数表现更稳，继续使用')}</strong><p>{t('验证记录 {0} 次 · 预测误差 {1} → {2}（越低越好）',result.validation,result.baselineLoss.toFixed(4),result.candidateLoss.toFixed(4))}</p>{result.accepted&&<button disabled={busy||dirty} className="btn-primary" onClick={()=>void save(result.config)}>{t('应用优化结果')}</button>}</div>}
    </div>
    <details className="fsrs-reschedule"><summary>{t('重新安排已学卡片')}</summary><p>{t('应用设置不会改动现有到期日。需要立即重排时，会先自动备份；暂停卡片和学习中的卡片不参与。')}</p><button className="btn-secondary" disabled={busy||dirty||!data} onClick={()=>setConfirm(true)}>{t('预览并重新安排')}</button></details>
    {confirm&&<div className="study-modal-backdrop"><section className="study-modal" role="dialog" aria-modal="true" aria-label={t('重新安排已学卡片')}><h2>{t('重新安排已学卡片')}</h2><p>{t('将更新 {0} 张卡片，未来 7 天到期量由 {1} 张变为 {2} 张。',projection.length,before,after)}</p><div className="fsrs-actions"><button className="btn-secondary" disabled={busy} onClick={()=>setConfirm(false)}>{t('取消')}</button><button className="btn-primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await rescheduleAll(baseline.id);await reload();setConfirm(false);setMessage(t('已备份并重新安排'))}catch(e){setError(String(e));setConfirm(false)}finally{setBusy(false)}}}>{t('备份并重新安排')}</button></div></section></div>}
  </section>
})
