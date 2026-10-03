export async function connect() {
  const pages = await (await fetch('http://127.0.0.1:9223/json')).json()
  const page = pages.find(page => page.url.startsWith('https://appassets.androidplatform.net/'))
  if (!page) throw new Error('Vibe Word WebView not found; adb forward the current app PID first')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const waiting = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    const entry = waiting.get(message.id)
    if (!entry) return
    waiting.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text + ': ' + JSON.stringify(value.exceptionDetails.exception))
    return value.result.value
  }
  return { call, evaluate, close: () => socket.close() }
}
