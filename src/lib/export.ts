// Export cards to Obsidian Spaced Repetition plugin format.
//
// The plugin uses `#flashcards` tag and separates front/back with `?` on its
// own line. Cards are separated by blank lines.
//
// Format:
//   #flashcards
//
//   front
//   ?
//   back
//   (blank line between cards)

import type { Card } from '../types'

export function cardsToObsidianMd(cards: Card[]): string {
  const lines: string[] = ['#flashcards', '']

  for (const card of cards) {
    const front = card.front.trim()
    const backParts: string[] = [card.back.trim()]
    if (card.example) {
      backParts.push(`*${card.example.trim()}*`)
    }
    const back = backParts.join(' ')

    lines.push(front)
    lines.push('?')
    lines.push(back)
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
