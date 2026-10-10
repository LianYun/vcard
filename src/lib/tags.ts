import type { Card } from '../types'

export function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))] : []
}
export function parseTags(value: string): string[] { return normalizeTags(value.split(/[,，\n]/)) }
// null means all cards; an empty string means untagged cards.
export function matchesTag(card: Card, tag: string | null): boolean {
  const tags = normalizeTags(card.tags)
  return tag === null || (tag === '' ? tags.length === 0 : tags.includes(tag))
}

/** Preserve empty-string sentinel for untagged cards. */
export function normalizeStudyScope(value: unknown): string[] | null {
  if (value == null) return null
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()))].sort()
}
export function matchesStudyScope(card: Card, scope: string[] | null): boolean {
  return scope === null || scope.some(tag => matchesTag(card, tag))
}
