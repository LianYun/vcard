import { t } from './i18n'

/** Shared playback controls for rendered Markdown and editor attachments. */
export function mountAudioPlayer(item: HTMLAudioElement, onError: (message: string) => void) {
  item.controls = false
  item.hidden = true
  const player = document.createElement('span')
  player.className = 'inline-audio'
  player.dataset.noFlip = ''
  const button = document.createElement('button')
  button.type = 'button'
  const progress = document.createElement('input')
  progress.type = 'range'
  progress.min = '0'
  progress.max = '100'
  progress.step = '0.1'
  progress.value = '0'
  progress.setAttribute('aria-label', t('音频进度'))
  const time = document.createElement('span')
  time.className = 'inline-audio-time'
  const format = (seconds: number) => {
    const value = Number.isFinite(seconds) ? Math.floor(seconds) : 0
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
  }
  const update = () => {
    const playing = !item.paused && !item.ended
    button.setAttribute('aria-label', t(playing ? '暂停播放' : '播放音频'))
    button.title = t(playing ? '暂停播放' : '播放音频')
    button.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5Z"/></svg>'
    progress.disabled = !Number.isFinite(item.duration) || item.duration <= 0
    progress.value = progress.disabled ? '0' : String(item.currentTime / item.duration * 100)
    time.textContent = Number.isFinite(item.duration) ? `${format(item.currentTime)} / ${format(item.duration)}` : `${format(item.currentTime)} / —`
  }
  button.onclick = () => {
    if (item.paused) void item.play().catch(() => { onError(t('音频格式不受支持或附件已损坏')) })
    else item.pause()
  }
  progress.oninput = () => { if (Number.isFinite(item.duration)) item.currentTime = Number(progress.value) / 100 * item.duration }
  player.onclick = event => event.stopPropagation()
  player.onkeydown = event => event.stopPropagation()
  player.append(button, progress, time)
  const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange']
  events.forEach(event => item.addEventListener(event, update))
  const pauseOthers = () => document.querySelectorAll('audio').forEach(other => { if (other !== item) other.pause() })
  const failure = () => onError(t('音频格式不受支持或附件已损坏'))
  item.addEventListener('play', pauseOthers)
  item.addEventListener('error', failure)
  update()
  return { element: player, dispose: () => {
    item.pause()
    events.forEach(event => item.removeEventListener(event, update))
    item.removeEventListener('play', pauseOthers)
    item.removeEventListener('error', failure)
    player.remove()
  } }
}
