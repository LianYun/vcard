// Only the packaged Android app supplies this interface. Desktop/browser keep
// using their existing implementations.
interface AndroidBridge {
  speak(text: string, language: string): void
  stopSpeech(): void
  exportMarkdown(content: string, filename: string): void
  request(id: string, url: string, headers: string, body: string): void
  cancelRequest(id: string): void
}

declare global {
  interface Window {
    VibeAndroid?: AndroidBridge
    __vibeNativeResponse?: (id: string, status: number, body: string, error: string | null) => void
  }
}

export const android = typeof window === 'undefined' ? undefined : window.VibeAndroid

const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void; cleanup: () => void }>()
if (android) {
  window.__vibeNativeResponse = (id, status, body, error) => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    entry.cleanup()
    if (error) entry.reject(new Error(error))
    else {
      try {
        entry.resolve(new Response([204, 205, 304].includes(status) ? null : body, { status, headers: { 'Content-Type': 'application/json' } }))
      } catch { entry.reject(new Error('API 返回了无效的 HTTP 响应')) }
    }
  }
}

// Native HTTP avoids WebView CORS restrictions for user-configured AI providers.
export function apiFetch(url: string, options: RequestInit): Promise<Response> {
  if (!android) return fetch(url, options)
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const id = crypto.randomUUID()
    const abort = () => {
      android.cancelRequest(id)
      pending.delete(id)
      cleanup()
      reject(new DOMException('已取消', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      android.cancelRequest(id)
      pending.delete(id)
      cleanup()
      reject(new Error('API 请求超时，请重试'))
    }, 180_000)
    const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort) }
    pending.set(id, { resolve, reject, cleanup })
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const headers: Record<string, string> = {}
      new Headers(options.headers).forEach((value, key) => { headers[key] = value })
      android.request(id, url, JSON.stringify(headers), String(options.body ?? ''))
    } catch (error) {
      pending.delete(id); cleanup(); reject(error)
    }
  })
}
