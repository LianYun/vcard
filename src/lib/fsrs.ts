import { fsrs, type FSRSState } from 'ts-fsrs'
import type { MemoryState, OptimizationResult, Quality, ReviewRecord, SchedulerConfig, SchedulingState } from '../types'
import { addDays, todayKey } from './date'

export const FSRS_ALGORITHM = 'fsrs-6-anki-v1'
export const DEFAULT_WEIGHTS = [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]
export const DEFAULT_SCHEDULER: SchedulerConfig = { version:6, id:'fsrs6-default-v1', retention:.9, maximumInterval:36500, learningSteps:[1,10], relearningSteps:[10], weights:DEFAULT_WEIGHTS }
export function validateConfig(c: SchedulerConfig): SchedulerConfig {
  if(c.version!==6 || !c.id || !Number.isFinite(c.retention) || c.retention<.7 || c.retention>.97 || !Number.isInteger(c.maximumInterval) || c.maximumInterval<1 || c.maximumInterval>36500 || c.weights.length!==21 || c.weights.some((w,i)=>!Number.isFinite(w)||w<=0||w>(i===7?1:100)) || c.weights[20]>1 || c.weights[15]>1 || c.weights[16]<1 || [c.learningSteps,c.relearningSteps].some(s=>!s.length||s.length>4||s.some((m,i)=>!Number.isFinite(m)||m<.1||m>=1440||(i>0&&m<=s[i-1])))) throw new Error('复习算法配置无效')
  return c
}
function engine(c: SchedulerConfig) { return fsrs({w:c.weights,request_retention:c.retention,maximum_interval:c.maximumInterval,enable_fuzz:false,enable_short_term:true}) }
export function elapsedDays(previous: number | null, now: number): number {
  if(previous==null) return 0
  const dayNumber=(v:number)=>{const [y,m,d]=todayKey(new Date(v)).split('-').map(Number);return Date.UTC(y,m-1,d)/86400000}
  return Math.max(0,dayNumber(now)-dayNumber(previous))
}
export function rating(q: Quality): number { return q<3?1:q-1 }
export function estimateMemory(s: SchedulingState,c=DEFAULT_SCHEDULER): MemoryState | undefined {
  if(s.lastReviewedAt==null) return undefined
  const stability=Math.max(.1,Math.min(36500,s.interval)),w=c.weights
  const difficulty=Math.max(1,Math.min(10,11-(s.ease-1)/(Math.exp(w[8])*Math.pow(stability,-w[9])*(Math.exp(.1*w[10])-1))))
  return {version:6,stability,difficulty,lapses:0,source:'estimated',parametersId:c.id}
}
export function migrateState(state: SchedulingState, history: ReviewRecord[],c=DEFAULT_SCHEDULER): SchedulingState {
  if(state.fsrs?.version===6 && state.fsrs.parametersId===c.id) return state
  const records=history.filter(r=>r.cardId===state.cardId&&!r.undone&&r.timestamp<=(state.lastReviewedAt??0)).sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id))
  if(!records.length || records[records.length-1].timestamp!==state.lastReviewedAt) return {...state,fsrs:state.fsrs ? {...state.fsrs,parametersId:c.id} : estimateMemory(state,c)}
  let memory: FSRSState | null=estimateMemory(records[0].before,c)??null
  let previous=records[0].before.lastReviewedAt, lapses=0
  const e=engine(c)
  for(const r of records) {
    if(r.before.lastReviewedAt!==previous) { memory=estimateMemory(r.before,c)??null;previous=r.before.lastReviewedAt }
    memory=e.next_state(memory,elapsedDays(previous,r.timestamp),rating(r.quality))
    if(r.quality<3&&r.before.phase==='review') lapses++
    previous=r.timestamp
  }
  return {...state,fsrs:{...memory!,version:6,lapses,source:records[0].before.lastReviewedAt==null?'history':'partial',parametersId:c.id}}
}
/** Shared policy around the upstream memory model. Calendar days match Anki's day boundary;
 * intraday steps are exact timestamps. No random input: previews and commits are reproducible. */
export function fsrsPreview(input: SchedulingState,c=DEFAULT_SCHEDULER,now=Date.now()): Record<number,SchedulingState> {
  validateConfig(c)
  const before=migrateState(input,[],c),e=engine(c),day=todayKey(new Date(now)),elapsed=elapsedDays(before.lastReviewedAt,now)
  const phase=before.phase??(before.lastReviewedAt==null?'new':'review')
  const results:Record<number,SchedulingState>={}
  let lastInterval=0
  for(const q of [1,3,4,5] as Quality[]) {
    const memory=e.next_state(before.fsrs??null,elapsed,rating(q))
    let interval:number=e.next_interval(memory.stability,elapsed)
    if(phase==='review'&&q>=3) { interval=Math.min(c.maximumInterval,Math.max(interval,lastInterval+1));lastInterval=interval }
    let nextPhase='review',step=0,minutes:number|null=null
    const relearning=phase==='relearning'||(phase==='review'&&q<3)
    const steps=relearning?c.relearningSteps:c.learningSteps
    const currentStep=Math.min(before.learningStep??0,steps.length-1)
    if(phase!=='review'||q<3) {
      if(q<3) { minutes=steps[0];step=0 }
      else if(q===3) { step=currentStep;minutes=currentStep===0?(steps.length>1?(steps[0]+steps[1])/2:steps[0]*1.5):steps[currentStep] }
      else if(q===4&&currentStep+1<steps.length) { step=currentStep+1;minutes=steps[step] }
      if(minutes!=null) nextPhase=relearning?'relearning':'learning'
    }
    const learningDue=minutes==null?null:now+Math.round(minutes*60000)
    results[q]={...before,fsrs:{...memory,version:6,lapses:(before.fsrs?.lapses??0)+(q<3&&phase==='review'?1:0),source:before.fsrs?.source??'new',parametersId:c.id},phase:nextPhase as SchedulingState['phase'],learningStep:step,learningDue,interval,repetitions:q<3?0:before.repetitions+1,due:learningDue==null?addDays(day,interval):todayKey(new Date(learningDue)),lastReviewedAt:now}
  }
  return results
}
export function retrievability(state: SchedulingState,c=DEFAULT_SCHEDULER,now=Date.now()): number | null {
  const m=state.fsrs??estimateMemory(state,c)
  return m?engine(c).forgetting_curve(Math.max(0,(now-(state.lastReviewedAt??now))/86400000),m.stability):null
}
export function rescheduleProjection(states: SchedulingState[],history:ReviewRecord[],c:SchedulerConfig,now=Date.now()) {
  const day=todayKey(new Date(now)),e=engine(c)
  const histories=new Map<string,ReviewRecord[]>()
  for(const r of history){const list=histories.get(r.cardId)??[];list.push(r);histories.set(r.cardId,list)}
  return states.filter(s=>s.lastReviewedAt!=null&&s.learningDue==null).map(s=>{
    const migrated=migrateState(s,histories.get(s.cardId)??[],c),interval=e.next_interval(migrated.fsrs!.stability,0)
    const due=addDays(todayKey(new Date(s.lastReviewedAt!)),interval)
    return {...migrated,interval,due:due<day?day:due}
  })
}
/** Bounded on-device coordinate fit. Holdout is chronologically later, never used to
 * choose coordinates. Only effective reviews with a reliable preceding state are scored. */
export function optimizeParameters(history:ReviewRecord[],config:SchedulerConfig,onProgress?:(n:number)=>void):OptimizationResult {
  const records=history.filter(r=>!r.undone&&[1,3,4,5].includes(r.quality)).sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id)).slice(-10000)
  const eligible=records.filter(r=>r.before.lastReviewedAt!=null&&elapsedDays(r.before.lastReviewedAt,r.timestamp)>0)
  if(eligible.length<200||eligible.filter(r=>r.quality<3).length<20||eligible.filter(r=>r.quality>=3).length<20) throw new Error('需要至少 200 次跨日复习，其中至少 20 次遗忘和 20 次记住')
  const cutoff=eligible[Math.floor(eligible.length*.8)].timestamp
  const holdout=eligible.filter(r=>r.timestamp>=cutoff)
  if(holdout.filter(r=>r.quality<3).length<5||holdout.filter(r=>r.quality>=3).length<5||eligible.filter(r=>r.timestamp<cutoff).length<100) throw new Error('验证记录不足，请积累更多不同日期的复习后再优化')
  function loss(weights:number[],validation:boolean):number {
    const c={...config,weights},e=engine(c),states=new Map<string,{memory:FSRSState;time:number}>()
    let sum=0,count=0
    for(const r of records) {
      const prior=states.get(r.cardId)
      const m=prior?.time===r.before.lastReviewedAt?prior.memory:estimateMemory(r.before,c)??null
      const elapsed=elapsedDays(r.before.lastReviewedAt,r.timestamp)
      if(m&&elapsed>0&&(r.timestamp>=cutoff)===validation) {
        const p=Math.max(.00001,Math.min(.99999,e.forgetting_curve(elapsed,m.stability)))
        sum-=r.quality<3?Math.log(1-p):Math.log(p);count++
      }
      states.set(r.cardId,{memory:e.next_state(m,elapsed,rating(r.quality)),time:r.timestamp})
    }
    return count?sum/count:Infinity
  }
  let weights=[...config.weights],score=loss(weights,false)
  // Fit the high-impact stability/growth/forgetting parameters with regularization.
  const indices=[0,1,2,3,8,9,10,11,12,13,14,15,16,17,18,19,20]
  for(let pass=0;pass<3;pass++) for(let n=0;n<indices.length;n++) {
    const i=indices[n],base=weights[i]
    for(const direction of [-1,1]) {
      const candidate=[...weights];candidate[i]=Math.max(.001,Math.min(i===15||i===20?1:100,base*Math.exp(direction*.15/(pass+1))))
      if(i===16)candidate[i]=Math.max(1,candidate[i])
      const penalty=candidate.reduce((v,w,j)=>v+Math.log(w/config.weights[j])**2,0)*.001
      const next=loss(candidate,false)+penalty
      if(next<score){weights=candidate;score=next}
    }
    onProgress?.((pass*indices.length+n+1)/(3*indices.length))
  }
  const baselineLoss=loss(config.weights,true),candidateLoss=loss(weights,true)
  const accepted=Number.isFinite(candidateLoss)&&candidateLoss<baselineLoss-.001
  return {config:accepted?{...config,id:crypto.randomUUID(),weights,optimizedAt:Date.now()}:config,samples:eligible.length,training:eligible.filter(r=>r.timestamp<cutoff).length,validation:eligible.filter(r=>r.timestamp>=cutoff).length,baselineLoss,candidateLoss,accepted}
}
