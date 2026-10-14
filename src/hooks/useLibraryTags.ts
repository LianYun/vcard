import { useEffect, useState } from 'react'
import { loadLibraryTags } from '../lib/storage'
import { normalizeTags } from '../lib/tags'

export function useLibraryTags(cardTags: string[]) {
  const [saved, setSaved] = useState<string[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let revision = 0
    const reload = () => {
      const current = ++revision
      void loadLibraryTags().then(tags => {
        if (active && current === revision) { setSaved(tags); setError('') }
      }).catch(reason => { if (active && current === revision) setError(String(reason)) })
    }
    reload()
    window.addEventListener('vibe-library-changed', reload)
    window.addEventListener('storage', reload)
    return () => { active = false; window.removeEventListener('vibe-library-changed', reload); window.removeEventListener('storage', reload) }
  }, [])
  return { tags: normalizeTags([...saved, ...cardTags]).sort((a, b) => a.localeCompare(b)), error }
}
