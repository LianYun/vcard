# Vibe Word UI System Refresh Design

Date: 2026-07-20

## Goal

Refresh Vibe Word toward a calm, durable study-tool feel. The app should look more cohesive without changing storage, scheduling, review logic, LLM generation, or card-management behavior.

## Product Direction

The interface should feel like a daily learning workspace: quiet, legible, and low-friction. It should avoid marketing-style decoration, heavy shadows, oversized rounded cards, and scattered one-off button treatments. The primary experience remains the study flow, with add, card management, and settings supporting that flow.

## Scope

In scope:

- App shell and tab navigation polish.
- Shared visual primitives for surfaces, buttons, fields, helper text, status text, and section headings.
- Study page hierarchy, card styling, progress, completion state, and review buttons.
- Add-card and settings forms using consistent inputs, labels, help text, and button levels.
- Card manager search, toolbar, empty states, grouped list, edit state, selection state, and destructive actions.
- App icon exploration with multiple candidate directions for user selection.

Out of scope:

- Changing SM-2 scheduling behavior.
- Changing persistence keys or storage structure.
- Adding a state-management library.
- Reworking the tab architecture into routing.
- Shipping a final icon replacement before the user selects a candidate.

## UI System

Add a small Tailwind component layer in `src/index.css` rather than introducing a component library. This keeps the codebase lightweight while reducing repeated class strings.

Proposed classes:

- `app-surface`: white or near-white panels with subtle border and restrained shadow.
- `app-surface-muted`: low-emphasis panels for empty states and passive information.
- `app-field`: consistent input styling, focus ring, sizing, and disabled state.
- `btn-primary`: main affirmative action.
- `btn-secondary`: neutral command action.
- `btn-danger`: destructive command action.
- `btn-ghost`: quiet toolbar or inline action.
- `section-title`, `section-copy`, and `status-*`: consistent typography for headings, helper text, and feedback.

Use moderate radii, stable spacing, and color semantics: brand for primary progress/action, emerald for success, rose for danger/again, amber/orange for hard, sky/blue for good, and slate for neutral UI.

## Page Design

### App Shell

Use a soft workspace background with a sticky-feeling top bar visually separated by a thin border. Navigation remains a tab row but adopts a segmented-control treatment with clearer active state and less visual noise.

### Study Page

The study page gets the strongest visual focus. The progress bar becomes quieter but more intentional, the card surface becomes less oversized and more stable, and the front/back labels become subtle metadata. Review buttons keep their current four-action model and shortcuts, but use a consistent compact button structure and semantic colors.

Completion state should look like a calm success panel rather than a celebratory marketing moment.

### Add Card

The add form should read as a focused tool panel. AI generation remains available when configured, but it should not visually compete with the primary manual-add flow. Success, queued, and error states use shared status text styles.

### Card Manager

The card manager should become easier to scan. Search and toolbar controls align to a clear utility row. Group headers stay collapsible but become visually quieter. Card rows use compact surfaces, stronger front-word hierarchy, readable markdown body text, and less prominent edit/delete controls.

### Settings

Settings should use the same form system as Add Card, with short copy and clear save actions. The AI configuration panel remains separate from study settings.

## App Icon Exploration

Generate a 2x2 preview sheet of four rounded-square app icon candidates:

- Word Card: minimal flashcard with a slight flip cue.
- V/W Monogram: professional letter mark for Vibe Word.
- Book + Spark: small dictionary or notebook with restrained AI hint.
- Review Loop: spaced-repetition loop or memory curve symbol.

Constraints:

- No readable text inside the icon.
- Must remain legible at small app-icon sizes.
- Rounded-square macOS/iOS icon composition.
- Calm learning-tool palette, compatible with the current brand blue-purple but not limited to one hue.

## Implementation Notes

Keep changes local to UI files:

- `src/index.css`
- `tailwind.config.js` only if additional brand tokens are needed.
- `src/App.tsx`
- Components under `src/components/`

Avoid touching storage, scheduler, card store, LLM integration, or hooks unless a type error exposes an existing UI dependency.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

If visual verification is available, run the dev server and inspect the main tabs on desktop-width and mobile-width layouts, checking for overlapping text, broken focus states, and awkward wrapping.
