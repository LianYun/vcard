# FSRS-6 review scheduling

Implemented 2026-10-08. UI follows the existing OpenDesign artifact `design/study-expansion.html`; actual application screenshots are `design/fsrs-settings-desktop.jpg`, `design/fsrs-settings-mobile.jpg`, and `design/fsrs-study-mobile.jpg`.

## Behavior and settings

All production review entry points use `fsrs-6-anki-v1`. The legacy SM-2 functions remain for historical regression fixtures only. TypeScript uses `src/lib/fsrs.ts`; Mac/iPhone/Watch use the shared `FSRSScheduler.swift` and vendored upstream memory model. Dependency provenance is in [FSRS-DEPENDENCIES.md](FSRS-DEPENDENCIES.md).

Defaults: 90% desired retention, learning steps 1 and 10 minutes, relearning 10 minutes, maximum interval 36500 days. Hard on the first learning step is 5.5 minutes, on the second 10 minutes. Good advances, Easy graduates, Again restarts the configured steps. Every rating updates FSRS memory, including same-day learning. Long-term Hard/Good/Easy are ordered with at least a day between them when the maximum permits; reaching the maximum permits ties.

The four persisted quality values remain 1/3/4/5 for history compatibility. The adapter maps them to FSRS 1/2/3/4. Stability, difficulty, lapses, model version, parameter version, and initialization provenance live in the optional `fsrs` field. Review events retain before/after states and the parameter snapshot. Learning due times are milliseconds; whole-day reviews use local calendar dates, including across DST. Cross-day elapsed time uses calendar days. The details screen's recall probability uses fractional elapsed time for display.

Deliberate differences from full Anki: deterministic intervals (no random fuzz/load balancing), the existing local-midnight day boundary, and a bounded local optimizer rather than Anki's full optimizer. FSRS-7 is not enabled. These are not advertised as exact Anki collection equivalence.

## Preview, commit and undo

Web and Mac pass a preview context containing the previous state, parameter ID and preview time. iPhone uses the same context. The storage transaction checks all three and refuses a stale context; stale contexts older than two minutes must be refreshed. Watch previews and commits share the same local timestamp and cached parameter snapshot. Updates never apply user-controlled candidate states directly.

Undo restores the previous memory state and sibling controls. A newer review or explicit rescheduling invalidates the old undo head. Practice remains read-only. Study-ahead still selects only previously learned cards due tomorrow through today + N (1–5), and grading uses the actual review date.

## Migration and compatibility

Existing due dates are preserved. Read projections initialize memory from complete effective history, or from an estimated SM-2 checkpoint followed by available history. When the final history timestamp does not match the current state, initialization uses that current checkpoint; missing ratings are never invented. Revoked reviews are excluded. Initialization is idempotent, and the first new rating persists it. Changing parameter versions reconstructs memory from available history without changing dates.

The first native FSRS review synchronously creates a full backup before committing. Browser/Android also create a backup before the first FSRS review. Native event files are version **4**, read versions 1–4. Browser storage uses `vibe-word:study:v3`, reading v2 only until the new document exists, so old tabs cannot overwrite new-model progress. Watch snapshot/outbox protocol is **3**; old local outboxes are retained, and further grading waits for a fresh phone snapshot with scheduler parameters. Native replay refuses a legacy state from overwriting an already-migrated state. All devices sharing native event files should be upgraded together. The legacy non-Mac SQLite backend retains a separate full scheduling checkpoint in `vibe-word:fsrs-checkpoints:v1`; its pre-existing lack of full-library backup/restore UI remains.

## Personal optimization

Settings → Smart review runs locally in a Web Worker (Web/Mac/Android) or a utility-priority detached task (iPhone). Watch consumes the resulting parameter set from the phone. No data is sent to a service.

The optimizer uses at most the latest 10000 effective records. It requires 200 cross-day observations, including 20 forgotten and 20 recalled. The latest 20% of eligible observations form a chronological holdout, with at least five outcomes of each class and at least 100 earlier training observations. Same-day observations update memory but are not scored as cross-day outcomes. It fits 17 high-impact stability/growth/forgetting parameters in three bounded coordinate passes with regularization; difficulty coefficients remain fixed. History is replayed for each candidate. Validation outcomes never select search coordinates. A candidate is offered only if holdout log loss improves by more than 0.001. Results show validation sample size and before/after loss; applying them is explicit. Insufficient or unbalanced history produces an explanatory message.

The retention slider forecasts only each studied card's **next** due date, including overdue cards, not the full number of future repetitions. Explicit rescheduling previews the affected count, makes a backup, and excludes suspended and intraday learning/relearning cards. Saving settings alone does not reschedule.

## Validation

- `npm run build`
- `node scripts/test-fsrs.mjs`: 384 TS/Swift fixtures, Anki step examples, interval ordering/caps, retention and elapsed-time effects, migration, stale context/config, exact preview commit, undo, backup, optimization, DST, suspended-card exclusions.
- `swift test --disable-sandbox --package-path ios`: includes memory, scheduling and optimizer parity against TypeScript, existing native store/Watch/session tests.
- Existing study, tags, decks, mobile and localization scripts.
- Mac bridge storage/folder exchange regression and iPhone/Watch combined simulator build.
- Browser: real rating/undo/details, optimization and apply, retention save, rescheduling confirmation, 390px layout. Local synthetic fixture at `/design/fsrs-preview.html` populates only an empty dev-server origin; it is not part of production builds.

Real paired Watch background delivery and real iCloud propagation remain device acceptance checks; local folder exchange and compilation do not establish them.
