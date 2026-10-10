import { useSyncExternalStore } from 'react'
import { generationQueue } from '../lib/generationQueue'

export function useGenerationQueue() {
  const tasks = useSyncExternalStore(
    generationQueue.subscribe,
    generationQueue.getSnapshot,
    generationQueue.getSnapshot,
  )
  return {
    tasks,
    enqueue: generationQueue.enqueue,
    cancel: generationQueue.cancel,
    resume: generationQueue.resume,
  }
}
