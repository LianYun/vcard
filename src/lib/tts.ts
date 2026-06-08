// Text-to-speech via the Web Speech API (speechSynthesis).
// Falls back gracefully when the API is unavailable.

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let cachedVoices: SpeechSynthesisVoice[] = []

function loadVoices(): SpeechSynthesisVoice[] {
  if (!isSupported()) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length > 0) cachedVoices = voices
  return cachedVoices
}

if (isSupported()) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = () => { loadVoices() }
}

function pickVoice(lang: 'en' | 'zh'): SpeechSynthesisVoice | undefined {
  const voices = loadVoices()
  const prefix = lang === 'en' ? 'en' : 'zh'

  // macOS high-quality voices
  const premium = voices.find(
    (v) => v.lang.startsWith(prefix) && /samantha|karen|daniel|moira|tessa/i.test(v.name),
  )
  if (premium) return premium

  // Any local (offline) voice for the language
  const local = voices.find(
    (v) => v.lang.startsWith(prefix) && v.localService,
  )
  if (local) return local

  // Any voice for the language
  return voices.find((v) => v.lang.startsWith(prefix))
}

export function speak(text: string, lang: 'en' | 'zh' = 'en'): void {
  if (!isSupported()) return
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-CN'
  utterance.rate = lang === 'en' ? 0.85 : 0.95
  utterance.pitch = 1.0
  utterance.volume = 1.0

  const voice = pickVoice(lang)
  if (voice) utterance.voice = voice

  window.speechSynthesis.speak(utterance)
}

export function stop(): void {
  if (!isSupported()) return
  window.speechSynthesis.cancel()
}
