import { optimizeParameters } from './fsrs'
self.onmessage=({data})=>{
  try { self.postMessage({result:optimizeParameters(data.history,data.config,n=>self.postMessage({progress:n}))}) }
  catch(error) { self.postMessage({error:String(error)}) }
}
