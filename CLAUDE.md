# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install deps
npm run dev        # dev server at http://localhost:5173
npm run build      # tsc -b (typecheck) then vite build
npm run typecheck  # tsc -b --noEmit (typecheck only, fast)
npm run preview    # preview the production build
npm run lint       # eslint (no config yet; script exists for later)
npm run tauri:dev  # launch as desktop app (dev mode, hot reload)
npm run tauri:build # build .dmg/.app installer (production)
```

Tauri requires Rust (`rustup`). The Rust project lives in `src-tauri/`;
`src-tauri/target/` is gitignored (large compilation output).

There is no test runner configured yet. `src/lib/sm2.ts` and `src/lib/scheduler.ts`
are written as pure functions specifically so tests can be added later (vitest fits).

## Architecture

Single-page React app, no backend. All state lives in `localStorage`. Data flow:

```
WordBank (static) ┐
CustomCards (LS) ─┤── allCards() ──┬── scheduler.schedule() ──→ today's queue
                  └── progress (LS)┘   (due reviews + new cards)
                                                                    │
                              useReviewQueue ── review(button) ── SM-2 grade ── write progress + meta
```

### Two sources of cards, one progress map

- **Built-in cards** (`src/data/wordbank.ts`): static, read-only, ship in the bundle.
  Ids prefixed `builtin:`.
- **Custom cards** (`src/lib/cardStore.ts` → `localStorage` key `vibe-word:cards:v1`):
  user-created, editable, deletable. Ids prefixed `custom:`.
- **Progress** (per-card scheduling state, `vibe-word:progress:v1`) is **independent of
  card source** — keyed by `cardId` regardless of origin. Deleting a custom card must also
  delete its progress entry, or the id lingers in scheduling.

`cardStore.allCards()` returns the merged list; everything downstream only ever sees
the unified `Card[]`.

### Storage layer (`src/lib/storage.ts`)

All localStorage access goes through one file with namespaced, versioned keys
(`:v1` suffix), try/catch on parse, and light validation. **Do not read/write
localStorage from components directly** — add/extend functions here. Keys:
`cards`, `progress`, `settings`, `meta`, `llmConfig`. `meta` tracks how many new cards were
issued today (resets when the date key rolls over). `llmConfig` stores the user's
OpenAI-compatible API credentials (baseURL, apiKey, model).

### SM-2 algorithm (`src/lib/sm2.ts`)

Pure functions, no side effects:
- `grade(prevState, quality)` → next `SchedulingState`. q<3 resets reps & interval to 1;
  q≥3 advances reps with intervals 1/6/round(prev·ease).
- `initialState(cardId)` for never-seen cards (`ease=2.5, interval=0, reps=0, due=today`).
- UI button → quality mapping lives in `GRADE_BY_BUTTON`
  (`again=1, hard=3, good=4, easy=5`).

Date math is whole-day granularity, YYYY-MM-DD in **local** time (`src/lib/date.ts`) —
never mix raw `Date` arithmetic with these keys.

### Scheduler (`src/lib/scheduler.ts`)

Pure w.r.t. its inputs — does not touch localStorage. Returns due reviews (most-overdue
first) + new cards (capped by `settings.newCardsPerDay` minus what `meta` shows was
already issued today). The counter reset-on-new-day is computed from `meta.newCardsDate`.
**Persisting the updated `meta` is the caller's responsibility** (see `useReviewQueue`).

### Session (`src/hooks/useReviewQueue.ts`)

Drives the live study session. Builds the queue once on mount, seeds progress entries
for new cards (so a half-finished session still "consumes" its budget), and on each
`review(button)` applies SM-2 + persists progress and meta. `again` re-appends the card
to the queue (Anki-style relearning); other buttons remove it.

### LLM integration (`src/lib/llm.ts`)

`generateCards(word, config)` calls an OpenAI-compatible `/chat/completions` endpoint
and returns two `Card` objects:
- **en→cn**: front = word, back = rich multi-line content (phonetic, definition,
  example, etymology, roots, similar words).
- **cn→en**: front = Chinese meaning + root hint, back = the English word.

The function is pure (no localStorage writes). The caller (`AddCardForm`) saves both
cards and seeds their progress entries. The prompt requests strict JSON; `extractJSON`
handles both raw JSON and fenced code blocks. Config (baseURL/apiKey/model) is stored
via `storage.ts` under `vibe-word:llm:v1`.

### UI layout (`src/App.tsx`)

Tabbed single-page: 学习 (StudyPage, runs the review session), 添加 (AddCardForm),
卡片 (CardManager), 设置 (SettingsPanel). A `StatsBar` at the top shows today's counts.
A shared `refreshKey` counter bumps `StatsBar`/`CardManager` after any mutation so they
re-read from storage (these components read localStorage directly in their render, not
from a store — hence the explicit refresh prop).

Styling is Tailwind; brand color tokens are defined in `tailwind.config.js`.

## Notes

- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters` — remove unused imports
  and disabled eslint lines when refactoring, or `npm run build` fails.
- Adding words: either extend `WORD_BANK` in code, or build UI that calls
  `cardStore.addCard()` (which persists to localStorage).
