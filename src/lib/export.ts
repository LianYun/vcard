// Export cards to Obsidian Spaced Repetition plugin format.
//
// The plugin uses `#flashcards` tag and separates front/back with `?` on its
// own line. Cards themselves are separated by blank lines, so any blank line
// inside a card's content would break it into multiple cards. We collapse
// blank lines to "soft breaks" (two trailing spaces + newline), which renders
// as a line break in markdown without splitting the card.
//
// Format:
//   #flashcards
//
//   front
//   ?
//   back (no internal blank lines)
//   (blank line between cards)

import type { Card } from '../types'
import { android } from './android'

/**
 * Strip blank lines inside a card's body. Multiple consecutive blank lines
 * become a single soft line break (two spaces + newline), preserving the
 * visual paragraph break in renderers but keeping the card as one unit.
 */
function flattenBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    // collapse 2+ consecutive newlines to a single newline preceded by a
    // markdown soft-break ("  \n").
    .replace(/\n\s*\n+/g, '  \n')
    .trim()
}

export function cardsToObsidianMd(cards: Card[]): string {
  const lines: string[] = ['#flashcards', '']

  for (const card of cards) {
    const front = flattenBlankLines(card.front)
    const backParts: string[] = [flattenBlankLines(card.back)]
    if (card.example) {
      backParts.push(`*${flattenBlankLines(card.example)}*`)
    }
    // Join example onto a new line (soft break) so it's distinct from the body.
    const back = backParts.join('  \n')

    lines.push(front)
    lines.push('?')
    lines.push(back)
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadMarkdown(content: string, filename: string): void {
  if (android) { android.exportMarkdown(content, filename); return }
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
