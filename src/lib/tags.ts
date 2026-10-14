import type { Card, Deck, StudyScope, CompositeStudyScope, StudyScopeRule } from '../types'

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
export function normalizeStudyTags(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()))].sort() : []
}
export function normalizeStudyScope(value: unknown, legacyDeckId: string | null = null): CompositeStudyScope {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const input = value as Partial<CompositeStudyScope>
    if (input.version !== 2) return { version: 2, mode: 'custom', rules: [] }
    if (input.mode === 'all') return { version: 2, mode: 'all', rules: [] }
    return { version: 2, mode: 'custom', rules: Array.isArray(input.rules) ? input.rules.map(rule => ({
      deckIds: rule?.deckIds === null ? null : normalizeTags(rule?.deckIds),
      tags: rule?.tags === null ? null : normalizeStudyTags(rule?.tags),
    })) : [] }
  }
  if (value == null && !legacyDeckId) return { version: 2, mode: 'all', rules: [] }
  return { version: 2, mode: 'custom', rules: [{ deckIds: legacyDeckId ? [legacyDeckId] : null, tags: value == null ? null : normalizeStudyTags(value) }] }
}
export function matchesScopeRule(card: Card, rule: StudyScopeRule, decks: Deck[] = []): boolean {
  const ancestry = new Set<string>()
  let id: string | undefined = card.deckId ?? 'default'
  while (id && !ancestry.has(id)) { ancestry.add(id); id = decks.find(deck => deck.id === id)?.parentId }
  return (rule.deckIds === null || rule.deckIds.some(id => ancestry.has(id))) &&
    (rule.tags === null || rule.tags.some(tag => matchesTag(card, tag)))
}
export function matchesStudyScope(card: Card, scope: StudyScope, decks: Deck[] = []): boolean {
  const normalized = normalizeStudyScope(scope)
  return normalized.mode === 'all' || normalized.rules.some(rule => matchesScopeRule(card, rule, decks))
}
export function validStudyScope(scope: StudyScope): boolean {
  const value = normalizeStudyScope(scope)
  return value.mode === 'all' || value.rules.length > 0 && value.rules.every(rule =>
    (rule.deckIds === null || rule.deckIds.length > 0) && (rule.tags === null || rule.tags.length > 0))
}
export function renameScopeTag(scope: StudyScope, source: string, target: string | null): CompositeStudyScope {
  const value = normalizeStudyScope(scope)
  // A removed tag stays as an unmatched reference. Never widen a saved rule.
  return { ...value, rules: value.rules.map(rule => ({ ...rule, tags: rule.tags?.map(tag => tag === source ? target ?? source : tag) ?? null })) }
}
